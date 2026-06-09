import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility consent and marketing overlays', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by overlay compatibility tests.
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

  it('skips consent managers, newsletter popups, and announcement bars while reading the page', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p id="readable-story">The meticulous article paragraph remains readable.</p>
          <section id="cookie-research">
            <p>The meticulous article about browser cookies remains readable.</p>
          </section>
        </article>
      </main>
      <section id="onetrust-banner-sdk">
        <div class="ot-sdk-container">The meticulous OneTrust banner should stay untouched.</div>
      </section>
      <section id="CybotCookiebotDialog">
        <p class="CookieDeclarationDialogText">The meticulous Cookiebot dialog should stay untouched.</p>
      </section>
      <aside class="newsletter-popup">The meticulous newsletter popup should stay untouched.</aside>
      <aside class="announcement-bar">The meticulous announcement bar should stay untouched.</aside>
      <div id="late-overlay-root"></div>
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

    expect(document.querySelector('#readable-story [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('#cookie-research [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('#onetrust-banner-sdk [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#CybotCookiebotDialog [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.newsletter-popup [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.announcement-bar [data-qianci-word]')).toBeNull();

    const lateOverlayRoot = document.querySelector('#late-overlay-root');
    if (!(lateOverlayRoot instanceof HTMLElement)) {
      throw new Error('Missing late overlay root');
    }
    lateOverlayRoot.innerHTML = `
      <section class="cookie-consent-banner">The meticulous late consent banner should stay untouched.</section>
      <section class="subscribe-modal">The meticulous late subscribe modal should stay untouched.</section>
    `;
    await flushScanWork();

    expect(document.querySelector('.cookie-consent-banner [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.subscribe-modal [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
