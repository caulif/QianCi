import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility spa routes', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by SPA compatibility tests.
   *
   * @param dictionary Entries keyed by normalized word.
   * @returns Async resolver matching the content app service contract.
   */
  function createResolver(dictionary: Record<string, DictionaryEntry>) {
    return async (word: string) => dictionary[word];
  }

  /**
   * Advances fake timers until the content scan queue has had time to finish.
   *
   * @returns Promise resolved after pending microtasks are flushed.
   */
  async function flushScanWork(): Promise<void> {
    vi.advanceTimersByTime(RESCAN_DELAY_MS);
    await Promise.resolve();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    }
  }

  /**
   * Reads visible tooltip text only when the tooltip is displayed.
   *
   * @returns Visible tooltip text, or empty string when hidden.
   */
  function visibleTooltipText(): string {
    const host = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    if (!host || host.style.display === 'none') {
      return '';
    }
    return host.shadowRoot?.textContent ?? host.textContent ?? '';
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('hides an old route tooltip and annotates the new route after root replacement', async () => {
    document.body.innerHTML = '<main id="app-root"><article><p>The unobtrusive first route is readable.</p></article></main>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/x/', translation: '细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const firstRouteWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    firstRouteWord.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(visibleTooltipText()).toContain('不显眼的');

    const root = document.querySelector('#app-root') as HTMLElement;
    root.innerHTML = '<article><p>The meticulous second route is readable.</p></article>';
    await Promise.resolve();
    await flushScanWork();

    expect(visibleTooltipText()).toBe('');
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(document.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('keeps annotations unique through rapid history route replacements', async () => {
    document.body.innerHTML = '<main id="app-root"><article><p>The unobtrusive first route is readable.</p></article></main>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/x/', translation: '细致的', rank: 9200 },
      ubiquitous: { word: 'ubiquitous', phonetic: '/x/', translation: '无处不在的', rank: 9300 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100, meticulous: 9200, ubiquitous: 9300 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const root = document.querySelector('#app-root') as HTMLElement;
    const firstRouteWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    firstRouteWord.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(visibleTooltipText()).toContain('不显眼的');

    history.pushState({}, '', '/second');
    root.innerHTML = '<article><p>The meticulous second route is readable.</p></article>';
    history.replaceState({}, '', '/third');
    root.innerHTML = '<article><p>The ubiquitous third route is readable.</p></article>';
    await Promise.resolve();
    await flushScanWork();

    expect(visibleTooltipText()).toBe('');
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(document.querySelector('[data-qianci-word="meticulous"]')).toBeNull();
    expect(document.querySelectorAll('[data-qianci-word="ubiquitous"]')).toHaveLength(1);

    history.pushState({}, '', '/second-again');
    root.innerHTML = '<article><p>The meticulous second route is readable again.</p></article>';
    await Promise.resolve();
    await flushScanWork();

    expect(document.querySelector('[data-qianci-word="ubiquitous"]')).toBeNull();
    expect(document.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);
    app.dispose();
  });
});
