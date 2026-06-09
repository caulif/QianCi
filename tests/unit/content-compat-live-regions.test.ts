import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility live regions', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by compatibility tests.
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

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips aria live status regions while annotating prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section id="polite-live" aria-live="polite">The meticulous live update should stay untouched.</section>
        <section id="status-toast" role="status">The meticulous status toast should stay untouched.</section>
        <section id="alert-toast" role="alert">The meticulous alert toast should stay untouched.</section>
      </main>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('#polite-live [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#status-toast [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#alert-toast [data-qianci-word]')).toBeNull();

    const politeLive = document.querySelector('#polite-live') as HTMLElement;
    politeLive.removeAttribute('aria-live');
    await Promise.resolve();
    await flushScanWork();

    expect(politeLive.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
