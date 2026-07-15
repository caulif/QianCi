import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfile } from '../../src/core/profile';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { saveCustomDictionary } from '../../src/storage/customDictionaryStore';
import { saveOnlineLookupQueue } from '../../src/storage/onlineLookupQueueStore';
import { loadProfile } from '../../src/storage/profileStore';
import { loadSitePolicies } from '../../src/storage/sitePolicyStore';
import {
  buildDiagnosticReport,
  buildFeedbackTemplate,
  countWeakHiddenWords,
  globalDensityFloorStatusText,
  globalDensityReduceStatusText,
  mountPopupApp,
  normalizePopupLookupQuery,
  optionsSectionHash,
  popupStatusHint,
  renderPopup,
  resolveLessAnnotateAction,
  resolveMoreStableAction,
  siteModeLabel
} from '../../src/popup/main';

describe('popup page', () => {
  it('renders status card and task-first site controls by default', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'manual-only',
      diagnostics: {
        siteMode: 'manual-only',
        annotatedWords: 3,
        scannedTextNodes: 20,
        pendingScan: false,
        lastScanAt: 1,
        lastScanDurationMs: 4,
        warnings: ['manual-only']
      }
    });

    expect(root.textContent).toContain('潜词 · example.com');
    expect(root.textContent).toContain('已检查 20 段 · 标注 3 词');
    expect(root.textContent).toContain('本站现在：仅手动查词');
    expect(root.textContent).toContain('少标一点');
    expect(root.textContent).toContain('更稳一点');
    expect(root.textContent).toContain('暂停');
    expect(root.textContent).toContain('快速查词');
    expect(root.textContent).toContain('漏词？');
    // 高级模式默认折叠
    expect(root.querySelectorAll('[data-qianci-site-mode]')).toHaveLength(0);
    expect(root.querySelector('[data-qianci-exclude-selectors]')).toBeNull();
  });

  it('maps user task actions to site modes with safe paused boundaries', () => {
    expect(siteModeLabel('low-density')).toBe('少标模式');
    expect(resolveLessAnnotateAction('auto')).toEqual({ kind: 'mode', mode: 'low-density' });
    expect(resolveLessAnnotateAction('low-density')).toEqual({ kind: 'reduce-density' });
    expect(resolveLessAnnotateAction('safe').kind).toBe('noop');
    expect(resolveLessAnnotateAction('paused').kind).toBe('noop');
    expect(resolveLessAnnotateAction('manual-only').kind).toBe('noop');
    expect(resolveMoreStableAction('auto')).toEqual({ kind: 'mode', mode: 'safe' });
    expect(resolveMoreStableAction('safe')).toEqual({ kind: 'mode', mode: 'manual-only' });
    expect(resolveMoreStableAction('paused').kind).toBe('noop');
    expect(resolveMoreStableAction('manual-only').kind).toBe('noop');
    expect(globalDensityReduceStatusText(0.9)).toContain('全局');
    expect(globalDensityReduceStatusText(0.9)).toContain('所有网站');
    expect(globalDensityFloorStatusText()).toContain('全局');
    expect(optionsSectionHash('#section-strategy')).toBe('section-strategy');
    expect(popupStatusHint({ mode: 'paused', diagnosticsStatusMessage: '已暂停' })).toBe('已暂停');
    expect(popupStatusHint({ mode: 'auto' })).toContain('无法注入内容脚本');
  });

  it('hides less/more/pause controls while site is paused', () => {
    const root = document.createElement('div');
    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'paused',
      diagnostics: {
        siteMode: 'paused',
        annotatedWords: 0,
        scannedTextNodes: 10,
        pendingScan: false,
        lastScanAt: 1,
        lastScanDurationMs: 2,
        warnings: ['paused']
      }
    });

    expect(root.querySelector('[data-qianci-less-annotate]')).toBeNull();
    expect(root.querySelector('[data-qianci-more-stable]')).toBeNull();
    expect(root.querySelector('[data-qianci-pause-site]')).toBeNull();
    expect(root.querySelector('[data-qianci-restore-auto]')?.textContent).toContain('恢复自动标注');
  });

  it('surfaces weak-hidden count and first-run hint on the status card', () => {
    const root = document.createElement('div');
    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'auto',
      weakHiddenCount: 3,
      showFirstRunHint: true,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 8,
        pendingScan: false,
        lastScanAt: 1,
        lastScanDurationMs: 2,
        warnings: []
      }
    });

    expect(root.textContent).toContain('被收起的词（3）');
    expect(root.querySelector('[data-qianci-first-run-hint]')).not.toBeNull();
    expect(countWeakHiddenWords({
      words: {
        a: { isKnown: false, familiarity: 3 },
        b: { isKnown: false, familiarity: 1 },
        c: { isKnown: true, familiarity: 9 }
      },
      feedbackSettings: { skipLimit: 3 }
    })).toBe(1);
  });

  it('shows full site modes and exclude selectors when advanced is open', () => {
    const root = document.createElement('div');
    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'manual-only',
      siteAdvancedOpen: true
    });

    expect(root.querySelectorAll('[data-qianci-site-mode]')).toHaveLength(5);
    expect(root.textContent).toContain('少标模式');
    expect(root.textContent).toContain('更稳模式');
    expect(root.querySelector('[data-qianci-exclude-selectors]')).not.toBeNull();
    expect(root.querySelector('[data-qianci-site-mode="manual-only"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('normalizes popup lookup input to a single english word', () => {
    expect(normalizePopupLookupQuery('  Resilience! ')).toBe('resilience');
    expect(normalizePopupLookupQuery('don’t')).toBe("don't");
    expect(normalizePopupLookupQuery('你好')).toBe('');
  });

  it('looks up a word from local custom dictionary in the popup', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    await saveCustomDictionary(store, {
      resilient: {
        word: 'resilient',
        phonetic: '/rɪˈzɪliənt/',
        translation: '有韧性的',
        rank: 1,
        source: 'custom'
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://example.com/article',
      store,
      openOptions: vi.fn(),
      lookupWord: vi.fn()
    });

    const input = root.querySelector<HTMLInputElement>('[data-qianci-lookup-input]');
    const form = root.querySelector<HTMLFormElement>('form.lookup-form');
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();

    input!.value = 'resilient';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(root.textContent).toContain('有韧性的');
    });
    expect(root.textContent).toContain('我的释义');
  });

  it('falls back to online lookup from the popup when local cache misses', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const lookupWord = vi.fn(async () => ({
      ok: true,
      message: 'ok',
      entry: {
        word: 'tenacious',
        phonetic: '/təˈneɪʃəs/',
        translation: '顽强的',
        rank: 999999,
        source: 'online' as const
      }
    }));

    await mountPopupApp(root, {
      currentUrl: async () => 'https://example.com/article',
      store,
      openOptions: vi.fn(),
      lookupWord
    });

    const input = root.querySelector<HTMLInputElement>('[data-qianci-lookup-input]');
    const form = root.querySelector<HTMLFormElement>('form.lookup-form');
    input!.value = 'tenacious';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(lookupWord).toHaveBeenCalledWith('tenacious');
      expect(root.textContent).toContain('顽强的');
    });
    expect(root.textContent).toContain('在线词典');
    expect(root.querySelector('[data-qianci-lookup-known="tenacious"]')).not.toBeNull();
  });

  it('marks a looked-up word as known from the popup', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    await saveCustomDictionary(store, {
      resilient: {
        word: 'resilient',
        phonetic: '',
        translation: '有韧性的',
        rank: 1,
        source: 'custom'
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://example.com/article',
      store,
      openOptions: vi.fn(),
      lookupWord: vi.fn()
    });

    const input = root.querySelector<HTMLInputElement>('[data-qianci-lookup-input]');
    const form = root.querySelector<HTMLFormElement>('form.lookup-form');
    input!.value = 'resilient';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(root.querySelector('[data-qianci-lookup-known="resilient"]')).not.toBeNull();
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-lookup-known="resilient"]')?.click();
    await vi.waitFor(async () => {
      const profile = await loadProfile(store);
      expect(profile?.words.resilient?.isKnown).toBe(true);
      expect(root.textContent).toContain('已将 resilient 标为认识');
    });
  });

  it('renders online lookup retry queue summary', () => {
    const root = document.createElement('div');
    const openOptions = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        retryQueueCount: 2
      },
      {
        onOpenOptions: openOptions
      }
    );

    expect(root.textContent).toContain('联网重试：2 个待处理');
    const retrySummary = root.querySelector<HTMLButtonElement>('[data-qianci-open-retry-queue]');
    expect(retrySummary).not.toBeNull();
    retrySummary?.click();
    expect(openOptions).toHaveBeenCalledWith('online-retry');
  });

  it('renders current page diagnostics and rescan action', () => {
    const root = document.createElement('div');
    const rescanPage = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 8,
          scannedTextNodes: 42,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 6,
          warnings: []
        }
      },
      {
        onRescanPage: rescanPage
      }
    );

    expect(root.textContent).toContain('本页工具');
    expect(root.textContent).toContain('已检查 42 段 · 标注 8 词');
    expect(root.textContent).toContain('当前空闲');
    const rescanButton = root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]');
    expect(rescanButton).not.toBeNull();
    rescanButton?.click();
    expect(rescanPage).toHaveBeenCalled();
  });

  it('builds a sanitized diagnostic report without page text', () => {
    const report = buildDiagnosticReport({
      siteKey: 'docs.example.com',
      mode: 'auto',
      retryQueueCount: 2,
      extensionVersion: '0.1.1-test',
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 8,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: ['dynamic-page', 'code-heavy']
      }
    });

    expect(report).toContain('潜词页面诊断');
    expect(report).toContain('schemaVersion：qianci-page-diagnostics-v1');
    expect(report).toContain('扩展版本：0.1.1-test');
    expect(report).toContain('生成时间：');
    expect(report).toContain('站点：docs.example.com');
    expect(report).toContain('模式：auto');
    expect(report).toContain('已标注：8');
    expect(report).toContain('已检查文本段：42');
    expect(report).toContain('重试队列：2');
    expect(report).toContain('警告：dynamic-page, code-heavy');
    expect(report).toContain('页面正文：不包含');
    expect(report).not.toContain('https://docs.example.com/article');
  });

  it('builds a sanitized feedback template users can paste into an issue', () => {
    const template = buildFeedbackTemplate({
      siteKey: 'docs.example.com',
      mode: 'auto',
      retryQueueCount: 2,
      extensionVersion: '0.1.1-test',
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: ['dynamic-page', 'code-heavy']
      }
    });

    expect(template).toContain('问题现象：');
    expect(template).toContain('期望结果：');
    expect(template).toContain('实际结果：');
    expect(template).toContain('诊断信息：');
    expect(template).toContain('站点：docs.example.com');
    expect(template).toContain('已标注：0');
    expect(template).toContain('警告：dynamic-page, code-heavy');
    expect(template).toContain('请不要粘贴页面正文、账号、token 或其它隐私内容。');
    expect(template).not.toContain('https://docs.example.com/article');
    expect(template).not.toContain('Selected secret text');
  });

  it('copies diagnostics from the popup panel', () => {
    const root = document.createElement('div');
    const copyDiagnostics = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        diagnosticsDetailsOpen: true,
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 8,
          scannedTextNodes: 42,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 6,
          warnings: []
        }
      },
      {
        onCopyDiagnostics: copyDiagnostics
      }
    );

    const copyButton = root.querySelector<HTMLButtonElement>('[data-qianci-copy-diagnostics]');
    expect(copyButton).not.toBeNull();
    expect(copyButton?.getAttribute('aria-label')).toBe('复制页面诊断信息');
    copyButton?.click();

    expect(copyDiagnostics).toHaveBeenCalledOnce();
    expect(copyDiagnostics.mock.calls[0][0]).toContain('站点：example.com');
  });

  it('copies a feedback template from the popup panel', () => {
    const root = document.createElement('div');
    const copyDiagnostics = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        retryQueueCount: 1,
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 0,
          scannedTextNodes: 42,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 6,
          warnings: ['dynamic-page']
        }
      },
      {
        onCopyDiagnostics: copyDiagnostics
      }
    );

    const copyButton = root.querySelector<HTMLButtonElement>('[data-qianci-copy-feedback-template]');
    expect(copyButton).not.toBeNull();
    expect(copyButton?.textContent).toBe('复制反馈');
    expect(copyButton?.getAttribute('aria-label')).toBe('复制页面问题反馈模板');
    copyButton?.click();

    expect(copyDiagnostics).toHaveBeenCalledOnce();
    expect(copyDiagnostics.mock.calls[0][0]).toContain('问题现象：');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('诊断信息：');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('站点：example.com');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('请不要粘贴页面正文、账号、token 或其它隐私内容。');
  });

  it('lets users copy a minimal report when page diagnostics are unavailable', () => {
    const root = document.createElement('div');
    const copyDiagnostics = vi.fn();
    const rescanPage = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'restricted.example.com',
        mode: 'auto',
        retryQueueCount: 1,
        extensionVersion: '0.1.1-test',
        diagnosticsDetailsOpen: true
      },
      {
        onRescanPage: rescanPage,
        onCopyDiagnostics: copyDiagnostics
      }
    );

    expect(root.textContent).toContain('当前页暂不可读');
    const rescanButton = root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]');
    expect(rescanButton).not.toBeNull();
    rescanButton?.click();
    expect(rescanPage).toHaveBeenCalledOnce();

    const copyButton = root.querySelector<HTMLButtonElement>('[data-qianci-copy-diagnostics]');
    expect(copyButton).not.toBeNull();
    copyButton?.click();

    expect(copyDiagnostics).toHaveBeenCalledOnce();
    expect(copyDiagnostics.mock.calls[0][0]).toContain('站点：restricted.example.com');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('扫描状态：不可读');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('重试队列：1');
    expect(copyDiagnostics.mock.calls[0][0]).toContain('页面正文：不包含');
    expect(copyDiagnostics.mock.calls[0][0]).not.toContain('coherence');
    expect(copyDiagnostics.mock.calls[0][0]).not.toContain('Selected secret text');
  });

  it('can retry diagnostics from an unavailable page and show the refreshed result', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const getPageDiagnostics = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 2,
        scannedTextNodes: 18,
        pendingScan: false,
        lastScanAt: 200,
        lastScanDurationMs: 5,
        warnings: []
      });
    const rescanPage = vi.fn().mockResolvedValue(undefined);

    await mountPopupApp(root, {
      currentUrl: async () => 'https://restricted.example.com/article',
      store,
      openOptions: vi.fn(),
      getPageDiagnostics,
      rescanPage
    });

    expect(root.textContent).toContain('当前页暂不可读');

    root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.click();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect(rescanPage).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('页面诊断已刷新');
    expect(root.textContent).toContain('标注 2 词');
  });

  it('explains when retrying diagnostics still cannot read the page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const getPageDiagnostics = vi.fn().mockResolvedValue(undefined);
    const rescanPage = vi.fn().mockResolvedValue(undefined);

    await mountPopupApp(root, {
      currentUrl: async () => 'https://restricted.example.com/article',
      store,
      openOptions: vi.fn(),
      getPageDiagnostics,
      rescanPage
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.click();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect(rescanPage).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('已重新扫描，但当前页面仍暂不可读，可刷新页面后再试。');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('explains why automatic annotation is unavailable on the current page', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'manual-only',
      diagnostics: {
        siteMode: 'manual-only',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 0,
        lastScanDurationMs: 0,
        warnings: ['manual-only']
      }
    });

    expect(root.textContent).toContain('仅手动查词中。可用选词查词，或点“恢复自动标注”。');
  });

  it('explains how to restore automatic annotation when the site is paused', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'paused',
      diagnostics: {
        siteMode: 'paused',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 0,
        lastScanDurationMs: 0,
        warnings: ['paused']
      }
    });

    expect(root.textContent).toContain('本站已暂停。点“恢复自动标注”可重新标注。');
    expect(root.querySelector('[data-qianci-restore-auto]')).not.toBeNull();
  });

  it('explains an empty annotation result after scanning readable text', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'auto',
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(root.textContent).toContain('已检查 36 段 · 标注 0 词');
    expect(root.textContent).toContain('暂无需要提醒的词');
    expect(root.textContent).toMatch(/右键|快查/);
    expect(root.textContent).toContain('多提醒一点（全局密度）');
    expect(buildDiagnosticReport({
      siteKey: 'example.com',
      mode: 'auto',
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    })).toContain('警告：无');
  });

  it('explains when no scannable text was found on a readable page', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'auto',
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 3,
        warnings: []
      }
    });

    expect(root.textContent).toContain('暂未找到可扫描的英文正文');
    expect(root.textContent).toContain('重新扫描');
  });

  it('keeps popup keyboard focus visibly outlined', () => {
    const styles = readFileSync(join(process.cwd(), 'src/popup/styles.css'), 'utf8');

    expect(styles).toContain(':focus-visible');
    expect(styles).toContain('outline: 2px solid');
    expect(styles).toContain('outline-offset: 2px');
    expect(styles).toContain('min-height: 32px');
  });

  it('offers a quick density increase when readable text has no automatic annotations', () => {
    const root = document.createElement('div');
    const increaseDensity = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        annotationDensity: 1,
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 0,
          scannedTextNodes: 36,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 5,
          warnings: []
        }
      },
      {
        onIncreaseAnnotationDensity: increaseDensity
      }
    );

    const increaseButton = root.querySelector<HTMLButtonElement>('[data-qianci-increase-density]');
    expect(increaseButton).not.toBeNull();
    expect(increaseButton?.textContent).toBe('多提醒一点（全局密度）');
    increaseButton?.click();
    expect(increaseDensity).toHaveBeenCalledOnce();
  });

  it('does not offer quick density increase at the maximum density', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'auto',
      annotationDensity: 1.25,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(root.querySelector('[data-qianci-increase-density]')).toBeNull();
  });

  it('does not offer quick density increase while rescanning or when diagnostics are not in auto mode', () => {
    const rescanningRoot = document.createElement('div');

    renderPopup(rescanningRoot, {
      siteKey: 'example.com',
      mode: 'auto',
      annotationDensity: 1,
      isRescanning: true,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(rescanningRoot.querySelector('[data-qianci-increase-density]')).toBeNull();

    const staleDiagnosticsRoot = document.createElement('div');
    renderPopup(staleDiagnosticsRoot, {
      siteKey: 'example.com',
      mode: 'auto',
      annotationDensity: 1,
      diagnostics: {
        siteMode: 'manual-only',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(staleDiagnosticsRoot.querySelector('[data-qianci-increase-density]')).toBeNull();
  });

  it('offers a quick density reset when annotation density is not balanced', () => {
    const root = document.createElement('div');
    const resetDensity = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'example.com',
        mode: 'auto',
        annotationDensity: 1.1,
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 3,
          scannedTextNodes: 36,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 5,
          warnings: []
        }
      },
      {
        onResetAnnotationDensity: resetDensity
      }
    );

    const resetButton = root.querySelector<HTMLButtonElement>('[data-qianci-reset-density]');
    expect(resetButton).not.toBeNull();
    expect(resetButton?.textContent).toBe('恢复默认全局密度');
    resetButton?.click();
    expect(resetDensity).toHaveBeenCalledOnce();
  });

  it('does not offer quick density reset while already balanced or rescanning', () => {
    const balancedRoot = document.createElement('div');
    renderPopup(balancedRoot, {
      siteKey: 'example.com',
      mode: 'auto',
      annotationDensity: 1,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 3,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(balancedRoot.querySelector('[data-qianci-reset-density]')).toBeNull();

    const rescanningRoot = document.createElement('div');
    renderPopup(rescanningRoot, {
      siteKey: 'example.com',
      mode: 'auto',
      annotationDensity: 0.9,
      isRescanning: true,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 3,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      }
    });

    expect(rescanningRoot.querySelector('[data-qianci-reset-density]')).toBeNull();
  });

  it('suggests manual-only mode for editor and code-heavy pages', () => {
    const root = document.createElement('div');
    const changeMode = vi.fn();

    renderPopup(
      root,
      {
        siteKey: 'docs.example.com',
        mode: 'auto',
        diagnostics: {
          siteMode: 'auto',
          annotatedWords: 2,
          scannedTextNodes: 12,
          pendingScan: false,
          lastScanAt: 100,
          lastScanDurationMs: 5,
          warnings: ['editor-detected', 'code-heavy']
        }
      },
      {
        onModeChange: changeMode
      }
    );

    expect(root.textContent).toContain('检测到编辑区，建议“更稳一点”或仅手动。');
    const safeModeButton = root.querySelector<HTMLButtonElement>('[data-qianci-safe-manual-mode]');
    expect(safeModeButton).not.toBeNull();
    safeModeButton?.click();
    expect(changeMode).toHaveBeenCalledWith('manual-only');
  });

  it('does not duplicate crowded-page density reduction beside the three main site buttons', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'docs.example.com',
      mode: 'auto',
      annotationDensity: 1,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 18,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: []
      }
    });

    // 「少标一点」承担本站/后续全局密度；工具区不再并列「再少标一些」
    expect(root.querySelector('[data-qianci-reduce-density]')).toBeNull();
    expect(root.querySelector('[data-qianci-less-annotate]')).not.toBeNull();
  });

  it('persists selected site mode and opens the full settings page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const openOptions = vi.fn();

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-pause-site]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    const policies = await loadSitePolicies(store);
    expect(policies['example.com']?.mode).toBe('paused');
    expect(root.textContent).toContain('本站现在：暂停本站');

    const settingsButton = root.querySelector<HTMLButtonElement>('[data-qianci-open-options]');
    settingsButton?.click();
    expect(openOptions).toHaveBeenCalled();
  });

  it('announces site mode changes and refreshes diagnostics when auto mode returns', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const rescanPage = vi.fn().mockResolvedValue(undefined);
    const getPageDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 4,
        scannedTextNodes: 20,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 4,
        warnings: []
      })
      .mockResolvedValueOnce({
        siteMode: 'paused',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 120,
        lastScanDurationMs: 0,
        warnings: ['paused']
      })
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 6,
        scannedTextNodes: 24,
        pendingScan: false,
        lastScanAt: 200,
        lastScanDurationMs: 5,
        warnings: []
      });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-pause-site]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    expect(root.textContent).toContain('已暂停当前站点');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(rescanPage).not.toHaveBeenCalled();
    expect(root.textContent).toContain('暂停本站');
    expect(root.textContent).toContain('标注 0 词');

    root.querySelector<HTMLButtonElement>('[data-qianci-restore-auto]')?.click();
    await vi.waitFor(() => {
      expect(rescanPage).toHaveBeenCalledOnce();
      expect(root.textContent).toContain('已恢复自动标注，并重新扫描当前页');
      expect(root.textContent).toContain('标注 6 词');
      expect(root.textContent).toContain('本站现在：自动标注');
    });
  });

  it('shows a recoverable warning when returning to auto mode cannot refresh the page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.sitePolicies': {
        'example.com': { mode: 'paused', updatedAt: 1 }
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage: vi.fn().mockRejectedValue(new Error('tab unavailable')),
      getPageDiagnostics: async () => ({
        siteMode: 'paused',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 0,
        warnings: ['paused']
      })
    });

    expect(root.querySelector('[data-qianci-restore-auto]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-qianci-restore-auto]')?.click();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('已恢复自动标注，但当前页刷新失败，请手动重新扫描或刷新页面。');
      expect(root.textContent).toContain('本站现在：自动标注');
    });
  });

  it('reduces global density via 少标一点 when already in low-density mode', async () => {
    const root = document.createElement('div');
    const rescanPage = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      'qianci.sitePolicies': {
        'example.com': {
          mode: 'low-density',
          updatedAt: Date.now(),
          excludeSelectors: [],
          allowSameOriginFrames: false
        }
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: async () => ({
        siteMode: 'low-density',
        annotatedWords: 8,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: ['low-density']
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-less-annotate]')?.click();
    await vi.waitFor(async () => {
      expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    });
    expect(root.textContent).toContain('全局标注密度');
    expect(root.textContent).toContain('所有网站');
    expect(root.textContent).toContain('本站现在：少标模式');
    expect(rescanPage).toHaveBeenCalledOnce();
  });

  it('shows loading feedback while global density is refreshing from low-density 少标一点', async () => {
    const root = document.createElement('div');
    let finishRescan!: () => void;
    const rescanPage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRescan = resolve;
        })
    );
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      'qianci.sitePolicies': {
        'example.com': {
          mode: 'low-density',
          updatedAt: Date.now(),
          excludeSelectors: [],
          allowSameOriginFrames: false
        }
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: async () => ({
        siteMode: 'low-density',
        annotatedWords: 8,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: ['low-density']
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-less-annotate]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('正在调整标注密度');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(rescanPage).toHaveBeenCalledOnce();

    finishRescan();
    await vi.waitFor(async () => {
      expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    });
  });

  it('keeps global density changes and shows a warning when density rescan fails', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      'qianci.sitePolicies': {
        'example.com': {
          mode: 'low-density',
          updatedAt: Date.now(),
          excludeSelectors: [],
          allowSameOriginFrames: false
        }
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage: vi.fn().mockRejectedValue(new Error('tab unavailable')),
      getPageDiagnostics: async () => ({
        siteMode: 'low-density',
        annotatedWords: 8,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: ['low-density']
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-less-annotate]')?.click();
    await vi.waitFor(async () => {
      expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    });
    expect(root.textContent).toContain('已调整标注密度，但当前页刷新失败，请手动重新扫描或刷新页面。');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps density changes and shows a warning when refreshed diagnostics fail', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });
    const getPageDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      })
      .mockRejectedValueOnce(new Error('diagnostics unavailable'));

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage: vi.fn().mockResolvedValue(undefined),
      getPageDiagnostics
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-increase-density]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    expect((await loadProfile(store))?.annotationDensity).toBe(1.1);
    expect(root.textContent).toContain('已调整标注密度，但当前页刷新失败，请手动重新扫描或刷新页面。');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('persists quick density increase from the popup and rescans the current page', async () => {
    const root = document.createElement('div');
    const rescanPage = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 0,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-increase-density]')?.click();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect((await loadProfile(store))?.annotationDensity).toBe(1.1);
    expect(root.textContent).toContain('已提高全局标注密度');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(rescanPage).toHaveBeenCalledOnce();
  });

  it('persists quick density reset from the popup and rescans the current page', async () => {
    const root = document.createElement('div');
    const rescanPage = vi.fn().mockResolvedValue(undefined);
    const store = createMemoryStore({
      'qianci.profile': { ...createProfile('cet4'), annotationDensity: 0.9 }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 3,
        scannedTextNodes: 36,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-reset-density]')?.click();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect((await loadProfile(store))?.annotationDensity).toBe(1);
    expect(root.textContent).toContain('已恢复默认全局标注密度');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(rescanPage).toHaveBeenCalledOnce();
  });

  it('loads online lookup retry queue count from storage', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();

    await saveOnlineLookupQueue(store, {
      coherence: {
        word: 'coherence',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 100,
        nextRetryAt: 200
      },
      ambiguous: {
        word: 'ambiguous',
        attempts: 2,
        lastErrorKind: 'rate_limited',
        lastTriedAt: 300,
        nextRetryAt: 400
      }
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn()
    });

    expect(root.textContent).toContain('联网重试：2 个待处理');
  });

  it('loads page diagnostics and refreshes them after rescan', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const getPageDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 1,
        scannedTextNodes: 10,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 4,
        warnings: []
      })
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 3,
        scannedTextNodes: 16,
        pendingScan: false,
        lastScanAt: 200,
        lastScanDurationMs: 5,
        warnings: []
      });
    const rescanPage = vi.fn().mockResolvedValue(undefined);

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      getPageDiagnostics,
      rescanPage
    });

    expect(root.textContent).toContain('标注 1 词');

    const rescanButton = root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]');
    rescanButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(rescanPage).toHaveBeenCalled();
    expect(root.textContent).toContain('标注 3 词');
  });

  it('shows immediate loading feedback while rescanning the current page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    let finishRescan!: () => void;
    const rescanPage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRescan = resolve;
        })
    );
    const getPageDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 1,
        scannedTextNodes: 10,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 4,
        warnings: []
      })
      .mockResolvedValueOnce({
        siteMode: 'auto',
        annotatedWords: 3,
        scannedTextNodes: 16,
        pendingScan: false,
        lastScanAt: 200,
        lastScanDurationMs: 5,
        warnings: []
      });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      getPageDiagnostics,
      rescanPage
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.click();
    await Promise.resolve();

    const loadingButton = root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]');
    expect(loadingButton?.disabled).toBe(true);
    expect(root.textContent).toContain('正在重新扫描本页');

    finishRescan();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('标注 3 词');
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.disabled).toBe(false);
  });

  it('shows failure feedback and recovers the rescan button when rescanning fails', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const rescanPage = vi.fn().mockRejectedValue(new Error('tab unavailable'));

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 1,
        scannedTextNodes: 10,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 4,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('重新扫描失败，请刷新页面后再试');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.disabled).toBe(false);
  });

  it('shows copy success and failure feedback for diagnostics', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const copyText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('clipboard denied'));

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      copyText,
      extensionVersion: async () => '0.1.1-test',
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 1,
        scannedTextNodes: 10,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 4,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-toggle-diagnostics]')?.click();
    await Promise.resolve();

    const copyButton = root.querySelector<HTMLButtonElement>('[data-qianci-copy-diagnostics]');
    copyButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText.mock.calls[0][0]).toContain('扩展版本：0.1.1-test');
    expect(root.textContent).toContain('诊断信息已复制');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    root.querySelector<HTMLButtonElement>('[data-qianci-copy-diagnostics]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('复制失败，可手动截图反馈');
    const manualCopy = root.querySelector<HTMLTextAreaElement>('[data-qianci-diagnostic-report]');
    expect(manualCopy).not.toBeNull();
    expect(manualCopy?.readOnly).toBe(true);
    expect(manualCopy?.value).toContain('schemaVersion：qianci-page-diagnostics-v1');
  });

  it('copies an unavailable-page diagnostic report from the mounted popup', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const copyText = vi.fn().mockResolvedValue(undefined);

    await mountPopupApp(root, {
      currentUrl: async () => 'https://restricted.example.com/article?token=secret',
      store,
      openOptions: vi.fn(),
      copyText,
      extensionVersion: async () => '0.1.1-test',
      getPageDiagnostics: async () => undefined
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-toggle-diagnostics]')?.click();
    await Promise.resolve();

    const copyButton = root.querySelector<HTMLButtonElement>('[data-qianci-copy-diagnostics]');
    copyButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledOnce();
    expect(copyText.mock.calls[0][0]).toContain('站点：restricted.example.com');
    expect(copyText.mock.calls[0][0]).toContain('扫描状态：不可读');
    expect(copyText.mock.calls[0][0]).not.toContain('token=secret');
    expect(copyText.mock.calls[0][0]).not.toContain('/article');
    expect(root.textContent).toContain('诊断信息已复制');
  });

  it('persists the diagnostic suggestion to switch into manual-only mode', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();

    await mountPopupApp(root, {
      currentUrl: async () => 'https://docs.example.com/editor',
      store,
      openOptions: vi.fn(),
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 2,
        scannedTextNodes: 12,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 5,
        warnings: ['editor-detected']
      })
    });

    const safeModeButton = root.querySelector<HTMLButtonElement>('[data-qianci-safe-manual-mode]');
    safeModeButton?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    const policies = await loadSitePolicies(store);
    expect(policies['docs.example.com']?.mode).toBe('manual-only');
    expect(root.textContent).toContain('本站现在：仅手动查词');
  });
});
