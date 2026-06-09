import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility high-density pages', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by high-density page tests.
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
   * Creates a content app with common high-density page service stubs.
   *
   * @returns Disposable content app instance.
   */
  function createCompatibilityApp() {
    return createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { meticulous: 9200, ubiquitous: 9300 },
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

  it('skips MDN-style sidebars, metadata, and compatibility tables while annotating article prose', async () => {
    document.body.innerHTML = `
      <main>
        <aside class="left-sidebar">The meticulous left sidebar should stay untouched.</aside>
        <article>
          <nav class="breadcrumbs">The meticulous breadcrumb should stay untouched.</nav>
          <p>The meticulous MDN explanation remains readable.</p>
          <aside class="reference-toc">The meticulous reference toc should stay untouched.</aside>
          <aside class="layout__right-sidebar">The meticulous right sidebar should stay untouched.</aside>
          <section class="metadata">The meticulous metadata should stay untouched.</section>
          <table class="bc-table"><tbody><tr><td>The meticulous compatibility data should stay untouched.</td></tr></tbody></table>
          <footer class="article-footer">The meticulous article footer should stay untouched.</footer>
        </article>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article > p [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.left-sidebar [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.breadcrumbs [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.reference-toc [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.layout__right-sidebar [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.metadata [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.bc-table [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.article-footer [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips search UI, urls, ads, related searches, and pagination while annotating snippets', async () => {
    document.body.innerHTML = `
      <main>
        <form role="search" class="search__form">
          <label>The meticulous search label should stay untouched.</label>
          <input class="search__input" value="meticulous query">
        </form>
        <section class="serp">
          <article class="result">
            <a class="result__title" href="/target">The meticulous result title remains readable.</a>
            <cite class="result__url">https://example.com/meticulous</cite>
            <p class="result__snippet">The meticulous result snippet remains readable.</p>
            <div class="result__extras">The meticulous result extra should stay untouched.</div>
          </article>
          <article class="result result--ad">The meticulous sponsored result should stay untouched.</article>
          <aside class="related-searches">The meticulous related search should stay untouched.</aside>
          <nav class="pagination">The meticulous pagination should stay untouched.</nav>
        </section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('.result__title [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.result__snippet [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('form[role="search"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.result__url [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.result__extras [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.result--ad [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.related-searches [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.pagination [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('keeps search result annotations unique through dynamic ads and result reordering', async () => {
    document.body.innerHTML = `
      <main>
        <section id="serp" class="serp">
          <article id="first-result" class="result">
            <a class="result__title" href="/first">The meticulous first result remains readable.</a>
            <p class="result__snippet">The meticulous first snippet remains readable.</p>
            <div class="result__sitelinks">The meticulous sitelink should stay untouched.</div>
          </article>
          <article id="second-result" class="result">
            <p class="result__snippet">The meticulous second snippet remains readable.</p>
          </article>
          <section class="people-also-ask">The meticulous question cluster should stay untouched.</section>
        </section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const searchResults = document.querySelector('#serp') as HTMLElement;
    const firstResult = document.querySelector('#first-result') as HTMLElement;
    const secondResult = document.querySelector('#second-result') as HTMLElement;
    expect(firstResult.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(2);
    expect(secondResult.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);
    expect(document.querySelector('.result__sitelinks [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.people-also-ask [data-qianci-word]')).toBeNull();

    const adResult = document.createElement('article');
    adResult.className = 'result result--ad';
    adResult.textContent = 'The meticulous inserted ad should stay untouched.';
    searchResults.prepend(adResult);
    searchResults.append(firstResult);
    secondResult.querySelector('.result__snippet')!.textContent = 'The meticulous updated snippet remains readable.';
    await Promise.resolve();
    await flushScanWork();

    expect(adResult.querySelector('[data-qianci-word]')).toBeNull();
    expect(firstResult.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(2);
    expect(secondResult.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);
    expect(secondResult.querySelector('[data-qianci-word] [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('keeps absolutely positioned virtual rows stable through fast recycled updates', async () => {
    document.body.innerHTML = `
      <main>
        <section id="virtual-list" style="height: 120px; overflow: auto; position: relative;">
          <div style="height: 4000px; position: relative;">
            <div id="virtual-measure" style="height: 0; overflow: hidden;">
              The meticulous measuring row should stay untouched.
            </div>
            <div
              id="absolute-row"
              style="position: absolute; top: 0; left: 0; transform: translateY(960px); height: 32px;"
            >
              The meticulous absolute virtual row is readable.
            </div>
          </div>
        </section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const virtualList = document.querySelector('#virtual-list') as HTMLElement;
    const absoluteRow = document.querySelector('#absolute-row') as HTMLElement;
    virtualList.scrollTop = 960;
    expect(absoluteRow.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);
    expect(document.querySelector('#virtual-measure [data-qianci-word]')).toBeNull();

    virtualList.scrollTop = 1920;
    absoluteRow.style.transform = 'translateY(1920px)';
    absoluteRow.textContent = 'The ubiquitous absolute virtual row was recycled.';
    await Promise.resolve();
    await flushScanWork();

    expect(virtualList.scrollTop).toBe(1920);
    expect(absoluteRow.querySelector('[data-qianci-word="meticulous"]')).toBeNull();
    expect(absoluteRow.querySelectorAll('[data-qianci-word="ubiquitous"]')).toHaveLength(1);
    expect(absoluteRow.querySelector('[data-qianci-word] [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
