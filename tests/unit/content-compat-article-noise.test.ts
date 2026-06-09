import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility article noise regions', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by article-noise compatibility tests.
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

  it('skips encyclopedia infoboxes, navboxes, and footnote references while reading prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
          <table class="infobox">
            <tbody><tr><td>The meticulous metadata label should stay untouched.</td></tr></tbody>
          </table>
          <table class="navbox">
            <tbody><tr><td>The meticulous related-topic navigation should stay untouched.</td></tr></tbody>
          </table>
          <p>
            A citation marker
            <sup class="reference">The meticulous reference marker should stay untouched.</sup>
            follows prose.
          </p>
          <section class="reflist">
            <ol><li>The meticulous reference list should stay untouched.</li></ol>
          </section>
          <aside role="complementary">The meticulous complementary sidebar should stay untouched.</aside>
        </article>
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

    expect(document.querySelector('article > p [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.infobox [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.navbox [data-qianci-word]')).toBeNull();
    expect(document.querySelector('sup.reference [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.reflist [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="complementary"] [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
