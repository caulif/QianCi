import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility pdf viewers', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by PDF viewer compatibility tests.
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
   * Creates a content app with common PDF viewer test service stubs.
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

  it('skips PDF.js text, annotation, and XFA layers while annotating surrounding prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous paper summary remains readable.</p>
        </article>
        <div class="pdfViewer">
          <div class="page" data-page-number="1">
            <canvas></canvas>
            <div class="textLayer">
              <span style="left: 10px; top: 20px;">The meticulous PDF text layer should stay untouched.</span>
            </div>
            <section class="annotationLayer">
              <a href="#paper">The meticulous PDF link annotation should stay untouched.</a>
            </section>
            <section class="xfaLayer">
              <div>The meticulous PDF form layer should stay untouched.</div>
            </section>
          </div>
        </div>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.textLayer [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.annotationLayer [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.xfaLayer [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('keeps lazily rendered PDF pages unmodified after the initial scan', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous abstract remains readable.</p>
        </article>
        <div id="viewer" class="pdfViewer"></div>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const viewer = document.querySelector('#viewer') as HTMLElement;
    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();

    viewer.innerHTML = `
      <div class="page" data-page-number="2">
        <div class="textLayer">
          <span>The meticulous lazy PDF text should stay untouched.</span>
        </div>
      </div>
    `;
    await Promise.resolve();
    await flushScanWork();

    expect(viewer.querySelector('.textLayer [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
