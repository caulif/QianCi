import { describe, expect, it, vi } from 'vitest';
import { buildVocabAnkiCsv, buildVocabCsv, buildVocabJson, mountOptionsApp, renderOptions } from '../../src/options/main';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { applySkipFeedback, createProfile } from '../../src/core/profile';
import { loadProfile } from '../../src/storage/profileStore';
import { loadOnlineLookupQueue, saveOnlineLookupQueue } from '../../src/storage/onlineLookupQueueStore';
import { loadCustomDictionary, saveCustomDictionary } from '../../src/storage/customDictionaryStore';
import { loadSitePolicies, saveSitePolicies } from '../../src/storage/sitePolicyStore';
import { loadVocab } from '../../src/storage/vocabStore';

describe('options page', () => {
  it('renders the level slider and vocab table', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      annotationDensity: 1,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ],
      knownWords: [
        { word: 'serendipity', lastSeenAt: 3 }
      ],
      onlineCacheCount: 2,
      retryQueueCount: 1,
      sitePolicyCount: 3
    });

    expect(root.textContent).toContain('四级');
    expect(root.textContent).toContain('标注密度');
    expect(root.textContent).toContain('平衡');
    expect(root.textContent).toContain('想少打扰就往左，想多提醒就往右。');
    expect(root.textContent).toContain('标注策略');
    expect(root.textContent).toContain('被跳过隐藏');
    expect(root.textContent).toContain('abrupt');
    expect(root.textContent).toContain('熟词');
    expect(root.textContent).toContain('serendipity');
    expect(root.textContent).toContain('数据与隐私');
    expect(root.textContent).toContain('生词 2 个 · 熟词 1 个 · 联网缓存 2 个 · 待重试 1 个 · 站点设置 3 个');
    expect(root.textContent).toContain('只有你主动联网补查时，潜词才会发送单个单词。');
    expect(root.querySelector('[data-qianci-clear-online-cache]')).not.toBeNull();
    expect(root.querySelector('[data-qianci-clear-site-policies]')).not.toBeNull();
    expect(root.querySelector('input[type="range"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-qianci-tone]')).toHaveLength(5);
    expect(root.querySelectorAll('[data-qianci-lookup-trigger]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-qianci-manual-shortcut]')).toHaveLength(4);
    expect(root.querySelectorAll('.vocab-table tbody')[0]?.querySelectorAll('tr')).toHaveLength(2);
  });

  it('renders a learning review panel grouped by user tasks', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      annotationDensity: 1,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 300, lookupCount: 1 },
        { word: 'meticulous', translation: '细致的', lastSeenAt: 200, lookupCount: 5 }
      ],
      knownWords: [
        { word: 'serendipity', lastSeenAt: 250 },
        { word: 'apple', lastSeenAt: 150 }
      ]
    });

    expect(root.textContent).toContain('学习回顾');
    expect(root.textContent).toContain('最近查过');
    expect(root.textContent).toContain('coherence');
    expect(root.textContent).toContain('查得最多');
    expect(root.textContent).toContain('meticulous · 5 次');
    expect(root.textContent).toContain('最近认识');
    expect(root.textContent).toContain('serendipity');
    expect(root.querySelector('[data-qianci-review-panel]')).not.toBeNull();
  });

  it('adds accessible labels to review cards, vocab tables, and export controls', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      annotationDensity: 1,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      vocab: [{ word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }],
      knownWords: [{ word: 'serendipity', lastSeenAt: 3 }]
    });

    const reviewPanel = root.querySelector<HTMLElement>('[data-qianci-review-panel]');
    expect(reviewPanel?.getAttribute('aria-labelledby')).toBe('qianci-learning-review-title');
    expect(root.querySelector('#qianci-learning-review-title')?.textContent).toBe('学习回顾');

    const tables = root.querySelectorAll<HTMLTableElement>('.vocab-table');
    expect(tables[0]?.querySelector('caption')?.textContent).toContain('生词列表');
    expect(tables[1]?.querySelector('caption')?.textContent).toContain('熟词列表');
    expect(tables[0]?.querySelector('thead th')?.getAttribute('scope')).toBe('col');
    expect(tables[0]?.querySelector('thead th:last-child')?.textContent).toBe('操作');
    expect(tables[1]?.querySelector('thead th:last-child')?.textContent).toBe('操作');
    expect(root.querySelector('[data-qianci-export-vocab]')?.getAttribute('aria-label')).toBe('导出生词 CSV');
    expect(root.querySelector('[data-qianci-export-vocab-json]')?.getAttribute('aria-label')).toBe('导出生词 JSON');
    expect(root.querySelector('[data-qianci-export-vocab-anki]')?.getAttribute('aria-label')).toBe(
      '导出生词 Anki CSV'
    );
  });

  it('marks the most frequently looked-up review word as known', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      'qianci.vocab': [
        { word: 'coherence', translation: '连贯性', lastSeenAt: 300, lookupCount: 1 },
        { word: 'meticulous', translation: '细致的', lastSeenAt: 200, lookupCount: 5 }
      ]
    });

    await mountOptionsApp(root, store);

    const markKnownButton = root.querySelector<HTMLButtonElement>('[data-qianci-review-mark-known="meticulous"]');
    expect(markKnownButton).not.toBeNull();
    expect(markKnownButton?.textContent).toBe('标为认识');
    markKnownButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.meticulous?.isKnown).toBe(true);
    expect((await loadVocab(store)).map((item) => item.word)).toEqual(['coherence']);
    expect(root.textContent).not.toContain('meticulous · 5 次');
    expect(root.textContent).toContain('最近认识');
    expect(root.textContent).toContain('meticulous');
  });

  it('does not apply the review mark-known action twice for the same word', async () => {
    const root = document.createElement('div');
    const baseProfile = createProfile('cet4');
    const store = createMemoryStore({
      'qianci.profile': baseProfile,
      'qianci.vocab': [{ word: 'meticulous', translation: '细致的', lastSeenAt: 200, lookupCount: 5 }]
    });

    await mountOptionsApp(root, store);

    const markKnownButton = root.querySelector<HTMLButtonElement>('[data-qianci-review-mark-known="meticulous"]');
    markKnownButton?.click();
    await Promise.resolve();
    markKnownButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.levelScore).toBeCloseTo(baseProfile.levelScore + 0.18);
    expect((await loadVocab(store))).toEqual([]);
  });

  it('filters vocab and known words by search text', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      annotationDensity: 1,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ],
      knownWords: [
        { word: 'serendipity', lastSeenAt: 3 },
        { word: 'apple', lastSeenAt: 4 }
      ],
      searchQuery: 'app'
    });

    const tables = root.querySelectorAll('.vocab-table tbody');
    expect(tables[0]?.textContent).not.toContain('abrupt');
    expect(tables[0]?.textContent).not.toContain('coherence');
    expect(tables[0]?.textContent).toContain('还没有生词');
    expect(tables[1]?.textContent).toContain('apple');
    expect(tables[1]?.textContent).not.toContain('serendipity');
  });

  it('lets the user remove vocab and move a known word back out of the known list', async () => {
    const root = document.createElement('div');
    const profile = createProfile('cet4');
    profile.words.apple = {
      familiarity: 0,
      isKnown: true,
      isUnknown: false,
      lastSeenAt: 3,
      seenPages: {}
    };

    const store = createMemoryStore({
      'qianci.profile': profile,
      'qianci.vocab': [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ]
    });

    await mountOptionsApp(root, store);

    const removeButtons = root.querySelectorAll('[data-qianci-remove-vocab]');
    expect(removeButtons).toHaveLength(2);
    (removeButtons[0] as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.textContent).not.toContain('abrupt');
    expect(root.textContent).toContain('coherence');

    const forgetButtons = root.querySelectorAll('[data-qianci-forget-known]');
    expect(forgetButtons).toHaveLength(1);
    (forgetButtons[0] as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.textContent).not.toContain('apple');
    expect(root.textContent).toContain('还没有熟词');
  });

  it('renders weak feedback summary and mode controls', () => {
    const root = document.createElement('div');
    const profile = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);

    renderOptions(root, {
      level: profile.level,
      annotationDensity: profile.annotationDensity,
      underlineTone: profile.underlineTone,
      lookupTrigger: profile.lookupTrigger,
      manualShortcut: profile.manualShortcut,
      feedbackSettings: profile.feedbackSettings,
      weakHiddenCount: 1,
      vocab: [],
      knownWords: [],
      skippedWords: [{ word: 'coherence', familiarity: 3, lastSeenAt: 100 }],
      alwaysAnnotatedWords: [{ word: 'abrupt', lastSeenAt: 200 }]
    });

    expect(root.textContent).toContain('如果一个词多次被标注但你没有查看释义');
    expect(root.textContent).toContain('被跳过隐藏：1 个');
    expect(root.textContent).toContain('coherence');
    expect(root.textContent).toContain('跳过 3 次');
    expect(root.querySelector('[data-qianci-restore-skip-feedback="coherence"]')).not.toBeNull();
    expect(root.querySelector('[data-qianci-always-annotate="coherence"]')).not.toBeNull();
    expect(root.textContent).toContain('总是提醒的词');
    expect(root.querySelector('[data-qianci-unpin-always-annotate="abrupt"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-qianci-suppression-mode]')).toHaveLength(3);
    expect(root.querySelector('[data-qianci-reset-skip-feedback]')).not.toBeNull();
  });

  it('renders online lookup retry queue summary and items', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      annotationDensity: 1,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      vocab: [],
      knownWords: [],
      onlineRetryItems: [
        {
          word: 'coherence',
          attempts: 1,
          lastErrorKind: 'network_error',
          lastTriedAt: 100,
          nextRetryAt: Date.now() + 120_000
        },
        {
          word: 'ambiguous',
          attempts: 2,
          lastErrorKind: 'rate_limited',
          lastTriedAt: 200,
          nextRetryAt: Date.now() + 600_000
        }
      ]
    });

    expect(root.textContent).toContain('联网补查重试队列');
    expect(root.textContent).toContain('还有 2 个词等待联网补查重试');
    expect(root.textContent).toContain('coherence');
    expect(root.textContent).toContain('第 1/3 次');
    expect(root.textContent).toContain('网络异常');
    expect(root.textContent).toContain('ambiguous');
    expect(root.textContent).toContain('请求过于频繁');
    expect(root.querySelector('[data-qianci-clear-retry-queue]')).not.toBeNull();
  });

  it('persists weak feedback mode and can reset weak skip feedback', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const skipped = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    skipped.words.apple = {
      familiarity: 2,
      isKnown: true,
      isUnknown: false,
      lastSeenAt: 200,
      seenPages: { 'page-a': true }
    };
    const store = createMemoryStore({
      'qianci.profile': skipped
    });

    await mountOptionsApp(root, store);

    const conservativeButton = root.querySelector<HTMLButtonElement>('[data-qianci-suppression-mode="conservative"]');
    conservativeButton?.click();
    await Promise.resolve();
    expect((await loadProfile(store))?.feedbackSettings.suppressionMode).toBe('conservative');

    const resetButton = root.querySelector<HTMLButtonElement>('[data-qianci-reset-skip-feedback]');
    resetButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.coherence?.familiarity).toBe(0);
    expect(profile?.words.coherence?.seenPages).toEqual({});
    expect(profile?.words.apple?.isKnown).toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('重置后，潜词会重新观察被你跳过的词。熟词和生词不会被删除。');
    confirmSpy.mockRestore();
  });

  it('persists annotation density changes from the settings page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });

    await mountOptionsApp(root, store);

    const densitySlider = root.querySelector<HTMLInputElement>('[data-qianci-annotation-density]');
    expect(densitySlider).not.toBeNull();
    expect(densitySlider?.getAttribute('aria-label')).toBe('标注密度');

    if (densitySlider) {
      densitySlider.value = '125';
      densitySlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await Promise.resolve();

    expect((await loadProfile(store))?.annotationDensity).toBe(1.25);
    expect(root.textContent).toContain('多标一些');
  });

  it('shows first-run guidance and lets users dismiss it', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });

    await mountOptionsApp(root, store);

    expect(root.textContent).toContain('三步开始使用潜词');
    expect(root.textContent).toContain('选择大致英语水平');
    expect(root.textContent).toContain('调节标注密度');
    expect(root.textContent).toContain('看到认识的词就点“认识”');

    const dismissButton = root.querySelector<HTMLButtonElement>('[data-qianci-dismiss-onboarding]');
    expect(dismissButton).not.toBeNull();
    dismissButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.onboardingDismissedAt).toEqual(expect.any(Number));
    expect(root.textContent).not.toContain('三步开始使用潜词');
    expect(root.querySelector('[data-qianci-reopen-onboarding]')).not.toBeNull();
  });

  it('applies an onboarding quiet reading preset without changing learning data', async () => {
    const root = document.createElement('div');
    const profile = createProfile('cet4');
    profile.words.coherence = {
      familiarity: 1,
      isKnown: false,
      isUnknown: true,
      lastSeenAt: 100,
      seenPages: { 'page-a': true }
    };
    const store = createMemoryStore({
      'qianci.profile': profile
    });

    await mountOptionsApp(root, store);

    const quietButton = root.querySelector<HTMLButtonElement>('[data-qianci-onboarding-preset="quiet"]');
    expect(quietButton).not.toBeNull();
    quietButton?.click();
    await Promise.resolve();

    const nextProfile = await loadProfile(store);
    expect(nextProfile?.annotationDensity).toBe(0.85);
    expect(nextProfile?.lookupTrigger).toBe('click');
    expect(nextProfile?.words.coherence?.isUnknown).toBe(true);
    expect(nextProfile?.onboardingDismissedAt).toEqual(expect.any(Number));
    expect(root.textContent).not.toContain('三步开始使用潜词');
  });

  it('applies balanced and learning onboarding presets', async () => {
    const balancedRoot = document.createElement('div');
    const balancedStore = createMemoryStore({
      'qianci.profile': {
        ...createProfile('cet4'),
        annotationDensity: 0.85,
        lookupTrigger: 'click'
      }
    });

    await mountOptionsApp(balancedRoot, balancedStore);
    balancedRoot.querySelector<HTMLButtonElement>('[data-qianci-onboarding-preset="balanced"]')?.click();
    await Promise.resolve();

    expect((await loadProfile(balancedStore))?.annotationDensity).toBe(1);
    expect((await loadProfile(balancedStore))?.lookupTrigger).toBe('hover');

    const learningRoot = document.createElement('div');
    const learningStore = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });

    await mountOptionsApp(learningRoot, learningStore);
    learningRoot.querySelector<HTMLButtonElement>('[data-qianci-onboarding-preset="learning"]')?.click();
    await Promise.resolve();

    expect((await loadProfile(learningStore))?.annotationDensity).toBe(1.15);
    expect((await loadProfile(learningStore))?.lookupTrigger).toBe('hover');
    expect((await loadProfile(learningStore))?.onboardingDismissedAt).toEqual(expect.any(Number));
  });

  it('can reopen first-run guidance after it was dismissed', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': {
        ...createProfile('cet4'),
        onboardingDismissedAt: 100
      }
    });

    await mountOptionsApp(root, store);

    expect(root.textContent).not.toContain('三步开始使用潜词');

    const reopenButton = root.querySelector<HTMLButtonElement>('[data-qianci-reopen-onboarding]');
    expect(reopenButton).not.toBeNull();
    reopenButton?.click();
    await Promise.resolve();

    expect((await loadProfile(store))?.onboardingDismissedAt).toBeUndefined();
    expect(root.textContent).toContain('三步开始使用潜词');
  });

  it('restores a single skipped word without clearing other weak feedback', async () => {
    const root = document.createElement('div');
    const skippedCoherence = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    const skippedAmbiguous = applySkipFeedback(skippedCoherence, 'ambiguous', 'page-a', 200);
    const store = createMemoryStore({
      'qianci.profile': skippedAmbiguous
    });

    await mountOptionsApp(root, store);

    const restoreButton = root.querySelector<HTMLButtonElement>('[data-qianci-restore-skip-feedback="coherence"]');
    restoreButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.coherence?.familiarity).toBe(0);
    expect(profile?.words.coherence?.seenPages).toEqual({});
    expect(profile?.words.ambiguous?.familiarity).toBe(1);
  });

  it('marks a skipped word as always annotated from the settings page', async () => {
    const root = document.createElement('div');
    const skippedOnce = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    const skippedTwice = applySkipFeedback(skippedOnce, 'coherence', 'page-b', 200);
    const skippedThreeTimes = applySkipFeedback(skippedTwice, 'coherence', 'page-c', 300);
    const store = createMemoryStore({
      'qianci.profile': skippedThreeTimes
    });

    await mountOptionsApp(root, store);

    const alwaysButton = root.querySelector<HTMLButtonElement>('[data-qianci-always-annotate="coherence"]');
    alwaysButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.coherence?.alwaysAnnotate).toBe(true);
    expect(profile?.words.coherence?.familiarity).toBe(0);
    expect(root.textContent).toContain('总是提醒的词');
    expect(root.textContent).toContain('coherence');
    expect(root.textContent).not.toContain('coherence · 跳过 3 次');
  });

  it('can remove an always annotated word from the settings page', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': {
        ...createProfile('cet4'),
        words: {
          coherence: {
            familiarity: 0,
            isKnown: false,
            isUnknown: false,
            alwaysAnnotate: true,
            lastSeenAt: 100,
            seenPages: {}
          }
        }
      }
    });

    await mountOptionsApp(root, store);

    const unpinButton = root.querySelector<HTMLButtonElement>('[data-qianci-unpin-always-annotate="coherence"]');
    unpinButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.coherence?.alwaysAnnotate).toBe(false);
    expect(root.textContent).not.toContain('总是提醒的词');
  });

  it('clears online lookup retry queue after confirmation', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const store = createMemoryStore();

    await saveOnlineLookupQueue(store, {
      coherence: {
        word: 'coherence',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 100,
        nextRetryAt: 200
      }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-retry-queue]');
    clearButton?.click();
    await Promise.resolve();

    expect(await loadOnlineLookupQueue(store)).toEqual({});
    expect(root.textContent).toContain('暂无待重试的联网补查');
    expect(confirmSpy).toHaveBeenCalledWith('清空后，潜词不会再自动重试这些联网查词。已保存的生词不会被删除。');
    confirmSpy.mockRestore();
  });

  it('keeps online lookup retry queue when clear is cancelled', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const store = createMemoryStore();

    await saveOnlineLookupQueue(store, {
      coherence: {
        word: 'coherence',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 100,
        nextRetryAt: 200
      }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-retry-queue]');
    clearButton?.click();
    await Promise.resolve();

    expect(Object.keys(await loadOnlineLookupQueue(store))).toEqual(['coherence']);
    expect(root.textContent).toContain('还有 1 个词等待联网补查重试');
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('clears online dictionary cache after confirmation', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const store = createMemoryStore();

    await saveCustomDictionary(store, {
      coherence: {
        word: 'coherence',
        phonetic: '',
        translation: '连贯性',
        rank: 10000,
        source: 'online'
      },
      bespoke: {
        word: 'bespoke',
        phonetic: '',
        translation: '定制的',
        rank: 12000,
        source: 'custom'
      }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-online-cache]');
    clearButton?.click();
    await Promise.resolve();

    expect(await loadCustomDictionary(store)).toEqual({
      bespoke: {
        word: 'bespoke',
        phonetic: '',
        translation: '定制的',
        rank: 12000,
        source: 'custom'
      }
    });
    expect(root.textContent).toContain('联网缓存 0 个');
    expect(confirmSpy).toHaveBeenCalledWith('清空后，已联网补查过的词会回到本地词库缺词状态。生词记录不会被删除。');
    confirmSpy.mockRestore();
  });

  it('keeps online dictionary cache when clear is cancelled', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const store = createMemoryStore();

    await saveCustomDictionary(store, {
      coherence: {
        word: 'coherence',
        phonetic: '',
        translation: '连贯性',
        rank: 10000,
        source: 'online'
      }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-online-cache]');
    clearButton?.click();
    await Promise.resolve();

    expect(Object.keys(await loadCustomDictionary(store))).toEqual(['coherence']);
    expect(root.textContent).toContain('联网缓存 1 个');
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('clears site policies after confirmation without touching learning data', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const profile = createProfile('cet4');
    const store = createMemoryStore({
      'qianci.profile': profile,
      'qianci.vocab': [{ word: 'coherence', translation: '连贯性', lastSeenAt: 100, lookupCount: 1 }]
    });
    await saveSitePolicies(store, {
      'docs.example.com': { mode: 'manual-only', updatedAt: 100 },
      'mail.example.com': { mode: 'paused', updatedAt: 200 }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-site-policies]');
    clearButton?.click();
    await Promise.resolve();

    expect(await loadSitePolicies(store)).toEqual({});
    expect((await loadProfile(store))?.level).toBe('cet4');
    expect(root.textContent).toContain('站点设置 0 个');
    expect(confirmSpy).toHaveBeenCalledWith('清空后，所有网站会恢复默认自动模式。生词和学习设置不会被删除。');
    confirmSpy.mockRestore();
  });

  it('keeps site policies when clear is cancelled', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const store = createMemoryStore();
    await saveSitePolicies(store, {
      'docs.example.com': { mode: 'manual-only', updatedAt: 100 }
    });

    await mountOptionsApp(root, store);

    const clearButton = root.querySelector<HTMLButtonElement>('[data-qianci-clear-site-policies]');
    clearButton?.click();
    await Promise.resolve();

    expect(Object.keys(await loadSitePolicies(store))).toEqual(['docs.example.com']);
    expect(root.textContent).toContain('站点设置 1 个');
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('keeps weak feedback when reset is cancelled', async () => {
    const root = document.createElement('div');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const skipped = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    const store = createMemoryStore({
      'qianci.profile': skipped
    });

    await mountOptionsApp(root, store);

    const resetButton = root.querySelector<HTMLButtonElement>('[data-qianci-reset-skip-feedback]');
    resetButton?.click();
    await Promise.resolve();

    const profile = await loadProfile(store);
    expect(profile?.words.coherence?.familiarity).toBe(1);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('CSV export', () => {
  it('escapes commas and quotes in vocab rows', () => {
    const csv = buildVocabCsv([
      { word: 'abrupt', translation: '突然的, "唐突的"', lastSeenAt: 100, lookupCount: 2 }
    ]);

    expect(csv).toContain('word,translation,lastSeenAt,lookupCount');
    expect(csv).toContain('abrupt,"突然的, ""唐突的""",100,2');
  });

  it('builds Anki-friendly rows with import file headers', () => {
    const csv = buildVocabAnkiCsv([
      { word: 'abrupt', translation: '突然的；意外的', lastSeenAt: 100, lookupCount: 2 },
      { word: 'quote', translation: '包含 "引号", 逗号', lastSeenAt: 200, lookupCount: 1 }
    ]);

    expect(csv).toBe(
      [
        '#separator:Comma',
        '#html:false',
        '#columns:Front,Back,Tags',
        '#tags column:3',
        'abrupt,突然的；意外的,qianci lookup_2',
        'quote,"包含 ""引号"", 逗号",qianci lookup_1'
      ].join('\n')
    );
  });
});

describe('JSON export', () => {
  it('builds a versioned vocab backup payload', () => {
    const json = buildVocabJson([
      { word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 2 }
    ]);
    const payload = JSON.parse(json) as {
      format: string;
      exportedAt: string;
      items: Array<{ word: string; translation: string; lastSeenAt: number; lookupCount: number }>;
    };

    expect(payload.format).toBe('qianci-vocab-json-v1');
    expect(new Date(payload.exportedAt).toString()).not.toBe('Invalid Date');
    expect(payload.items).toEqual([
      { word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 2 }
    ]);
  });

  it('renders a JSON export control beside CSV export', () => {
    const root = document.createElement('div');
    const exportJson = vi.fn();

    renderOptions(
      root,
      {
        level: 'cet4',
        annotationDensity: 1,
        underlineTone: 'graphite',
        lookupTrigger: 'hover',
        manualShortcut: 'alt',
        feedbackSettings: createProfile('cet4').feedbackSettings,
        vocab: [{ word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 2 }],
        knownWords: [],
        onlineRetryItems: [],
        onlineCacheCount: 0,
        sitePolicyCount: 0
      },
      { onExportJson: exportJson }
    );

    const jsonButton = root.querySelector<HTMLButtonElement>('[data-qianci-export-vocab-json]');
    jsonButton?.click();

    expect(jsonButton?.textContent).toBe('JSON');
    expect(jsonButton?.classList.contains('vocab-export-button')).toBe(true);
    expect(exportJson).toHaveBeenCalledOnce();
    expect(JSON.parse(exportJson.mock.calls[0][0]).format).toBe('qianci-vocab-json-v1');
  });

  it('renders an Anki CSV export control beside regular exports', () => {
    const root = document.createElement('div');
    const exportAnki = vi.fn();

    renderOptions(
      root,
      {
        level: 'cet4',
        annotationDensity: 1,
        underlineTone: 'graphite',
        lookupTrigger: 'hover',
        manualShortcut: 'alt',
        feedbackSettings: createProfile('cet4').feedbackSettings,
        vocab: [{ word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 2 }],
        knownWords: [],
        onlineRetryItems: [],
        onlineCacheCount: 0,
        sitePolicyCount: 0
      },
      { onExportAnki: exportAnki }
    );

    const ankiButton = root.querySelector<HTMLButtonElement>('[data-qianci-export-vocab-anki]');
    ankiButton?.click();

    expect(ankiButton?.textContent).toBe('Anki');
    expect(ankiButton?.classList.contains('vocab-export-button')).toBe(true);
    expect(exportAnki).toHaveBeenCalledWith(
      [
        '#separator:Comma',
        '#html:false',
        '#columns:Front,Back,Tags',
        '#tags column:3',
        'abrupt,突然的,qianci lookup_2'
      ].join('\n')
    );
  });
});
