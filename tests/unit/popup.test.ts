import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProfile } from '../../src/core/profile';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { saveOnlineLookupQueue } from '../../src/storage/onlineLookupQueueStore';
import { loadProfile } from '../../src/storage/profileStore';
import { loadSitePolicies } from '../../src/storage/sitePolicyStore';
import { buildDiagnosticReport, buildFeedbackTemplate, mountPopupApp, renderPopup } from '../../src/popup/main';

describe('popup page', () => {
  it('renders current site controls with the active mode selected', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'example.com',
      mode: 'manual-only'
    });

    expect(root.textContent).toContain('example.com');
    expect(root.textContent).toContain('当前站点');
    expect(root.querySelectorAll('[data-qianci-site-mode]')).toHaveLength(3);
    expect(root.querySelector('[data-qianci-site-mode="manual-only"]')?.getAttribute('aria-pressed')).toBe('true');
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

    expect(root.textContent).toContain('联网补查：2 个待重试');
    const retrySummary = root.querySelector<HTMLButtonElement>('[data-qianci-open-retry-queue]');
    expect(retrySummary).not.toBeNull();
    retrySummary?.click();
    expect(openOptions).toHaveBeenCalled();
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

    expect(root.textContent).toContain('页面诊断');
    expect(root.textContent).toContain('已标注 8 个词');
    expect(root.textContent).toContain('已检查文本 42 段');
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
    expect(copyButton?.textContent).toBe('复制反馈模板');
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
        extensionVersion: '0.1.1-test'
      },
      {
        onRescanPage: rescanPage,
        onCopyDiagnostics: copyDiagnostics
      }
    );

    expect(root.textContent).toContain('当前页面暂不可读');
    expect(root.textContent).toContain('可以先点击“重新扫描本页”');
    expect(root.textContent).toContain('仍不可用时可复制反馈模板');
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

    expect(root.textContent).toContain('当前页面暂不可读');

    root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.click();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect(rescanPage).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('页面诊断已刷新');
    expect(root.textContent).toContain('已标注 2 个词');
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

    expect(root.textContent).toContain('当前是仅手动查词，不会自动标注。');
    expect(root.textContent).toContain('如需自动标注，请切回“自动标注”。');
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

    expect(root.textContent).toContain('当前站点已暂停，潜词不会处理这个页面。');
    expect(root.textContent).toContain('如需恢复，请切回“自动标注”。');
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

    expect(root.textContent).toContain('已检查文本 36 段');
    expect(root.textContent).toContain('暂未发现需要提醒的词');
    expect(root.textContent).toContain('这通常表示页面可扫描，但当前词汇已认识、低于提醒阈值，或标注密度较保守');
    expect(root.textContent).toContain('如果有漏掉的词，可以用 Alt + 选词手动查词');
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

    expect(root.textContent).toContain('暂未找到可自动扫描的正文');
    expect(root.textContent).toContain('可以用 Alt + 选词手动查词');
    expect(root.textContent).toContain('或点击“复制反馈模板”反馈这个页面');
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

    expect(root.textContent).toContain('想多提醒一点？');
    const increaseButton = root.querySelector<HTMLButtonElement>('[data-qianci-increase-density]');
    expect(increaseButton).not.toBeNull();
    expect(increaseButton?.textContent).toBe('多提醒一点');
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
    expect(resetButton?.textContent).toBe('恢复平衡');
    expect(root.textContent).toContain('只恢复默认标注密度，不改变学习记录或站点模式');
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

    expect(root.textContent).toContain('检测到编辑区，建议切到仅手动查词，避免打断输入。');
    expect(root.textContent).toContain('代码内容较多，需要时可划词或右键查词。');
    const safeModeButton = root.querySelector<HTMLButtonElement>('[data-qianci-safe-manual-mode]');
    expect(safeModeButton).not.toBeNull();
    safeModeButton?.click();
    expect(changeMode).toHaveBeenCalledWith('manual-only');
  });

  it('offers a quick density reduction when automatic annotation looks crowded', () => {
    const root = document.createElement('div');
    const reduceDensity = vi.fn();

    renderPopup(
      root,
      {
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
      },
      {
        onReduceAnnotationDensity: reduceDensity
      }
    );

    expect(root.textContent).toContain('标注有点多？');
    const reduceButton = root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]');
    expect(reduceButton).not.toBeNull();
    expect(reduceButton?.textContent).toBe('少标一些');
    reduceButton?.click();
    expect(reduceDensity).toHaveBeenCalledOnce();
  });

  it('does not offer quick density reduction while diagnostics are still scanning', () => {
    const root = document.createElement('div');

    renderPopup(root, {
      siteKey: 'docs.example.com',
      mode: 'auto',
      annotationDensity: 1,
      diagnostics: {
        siteMode: 'auto',
        annotatedWords: 18,
        scannedTextNodes: 42,
        pendingScan: true,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: []
      }
    });

    expect(root.querySelector('[data-qianci-reduce-density]')).toBeNull();
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

    const pauseButton = root.querySelector<HTMLButtonElement>('[data-qianci-site-mode="paused"]');
    pauseButton?.click();
    await Promise.resolve();

    const policies = await loadSitePolicies(store);
    expect(policies['example.com']?.mode).toBe('paused');
    expect(root.querySelector('[data-qianci-site-mode="paused"]')?.getAttribute('aria-pressed')).toBe('true');

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

    root.querySelector<HTMLButtonElement>('[data-qianci-site-mode="paused"]')?.click();
    await Promise.resolve();

    expect(root.textContent).toContain('已暂停当前站点');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(rescanPage).not.toHaveBeenCalled();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }
    expect(root.textContent).toContain('当前站点已暂停，潜词不会处理这个页面。');
    expect(root.textContent).toContain('已标注 0 个词');

    root.querySelector<HTMLButtonElement>('[data-qianci-site-mode="auto"]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    expect(rescanPage).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('已恢复自动标注，并重新扫描当前页');
    expect(root.textContent).toContain('已标注 6 个词');
    expect(root.querySelector('[data-qianci-site-mode="auto"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a recoverable warning when returning to auto mode cannot refresh the page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage: vi.fn().mockRejectedValue(new Error('tab unavailable')),
      getPageDiagnostics: async () => ({
        siteMode: 'manual-only',
        annotatedWords: 0,
        scannedTextNodes: 0,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 0,
        warnings: ['manual-only']
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-site-mode="auto"]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    expect(root.textContent).toContain('已恢复自动标注，但当前页刷新失败，请手动重新扫描或刷新页面。');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('[data-qianci-site-mode="auto"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('persists quick density reduction from the popup without changing site mode', async () => {
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
        annotatedWords: 18,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    expect(root.textContent).toContain('已调低标注密度');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('[data-qianci-site-mode="auto"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rescanPage).toHaveBeenCalledOnce();
  });

  it('shows loading feedback and prevents repeated density changes while refreshing the page', async () => {
    const root = document.createElement('div');
    let finishRescan!: () => void;
    const rescanPage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRescan = resolve;
        })
    );
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
        annotatedWords: 18,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.click();
    await Promise.resolve();
    await Promise.resolve();

    const loadingButton = root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]');
    expect(loadingButton?.disabled).toBe(true);
    expect(loadingButton?.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).toContain('正在调整标注密度');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    loadingButton?.click();
    await Promise.resolve();
    expect(rescanPage).toHaveBeenCalledOnce();

    finishRescan();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await Promise.resolve();
    }

    expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.disabled).toBe(false);
  });

  it('keeps density changes and shows a warning when density rescan fails', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage: vi.fn().mockRejectedValue(new Error('tab unavailable')),
      getPageDiagnostics: async () => ({
        siteMode: 'auto',
        annotatedWords: 18,
        scannedTextNodes: 42,
        pendingScan: false,
        lastScanAt: 100,
        lastScanDurationMs: 6,
        warnings: []
      })
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }

    expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
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
    expect(root.textContent).toContain('已调高标注密度');
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
    expect(root.textContent).toContain('已恢复平衡标注密度');
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

    expect(root.textContent).toContain('联网补查：2 个待重试');
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

    expect(root.textContent).toContain('已标注 1 个词');

    const rescanButton = root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]');
    rescanButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(rescanPage).toHaveBeenCalled();
    expect(root.textContent).toContain('已标注 3 个词');
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
    expect(loadingButton?.getAttribute('aria-busy')).toBe('true');
    expect(root.textContent).toContain('正在重新扫描本页');
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    finishRescan();
    await Promise.resolve();
    await Promise.resolve();

    expect(root.textContent).toContain('已标注 3 个词');
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
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-atomic')).toBe('true');
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
    await Promise.resolve();

    const policies = await loadSitePolicies(store);
    expect(policies['docs.example.com']?.mode).toBe('manual-only');
    expect(root.querySelector('[data-qianci-site-mode="manual-only"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
