import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility academic pages', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by academic page compatibility tests.
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
   * Creates a content app with common academic page service stubs.
   *
   * @returns Disposable content app instance.
   */
  function createCompatibilityApp() {
    return createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips academic citations, footnotes, bibliography, and equation numbers while annotating prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <header class="ltx_authors">The meticulous author metadata should stay untouched.</header>
          <section class="abstract">
            <p>The meticulous abstract remains readable.</p>
          </section>
          <p>The meticulous paper body remains readable.</p>
          <a class="ltx_ref" href="#bib1">The meticulous citation link should stay untouched.</a>
          <span class="citation">The meticulous inline citation should stay untouched.</span>
          <span class="ltx_tag ltx_tag_equation">The meticulous equation number should stay untouched.</span>
          <aside role="doc-footnote">The meticulous doc footnote should stay untouched.</aside>
          <section class="footnotes">The meticulous footnote list should stay untouched.</section>
          <section role="doc-bibliography" class="bibliography">
            <p id="bib1">The meticulous bibliography entry should stay untouched.</p>
          </section>
        </article>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('.abstract [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('article > p [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.ltx_authors [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.ltx_ref [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.citation [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.ltx_tag_equation [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="doc-footnote"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.footnotes [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="doc-bibliography"] [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips lazily inserted citation popups after the article is already scanned', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
          <span id="citation-popups"></span>
        </article>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const popups = document.querySelector('#citation-popups') as HTMLElement;
    expect(document.querySelector('article > p [data-qianci-word="meticulous"]')).not.toBeNull();

    popups.innerHTML = `
      <span class="tippy-box citation-tooltip" role="tooltip">
        The meticulous citation preview should stay untouched.
      </span>
    `;
    await Promise.resolve();
    await flushScanWork();

    expect(popups.querySelector('[data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
