import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility code hosting pages', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by code-host compatibility tests.
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
   * Creates a content app with common code-host test service stubs.
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

  it('skips GitHub-style diff code and gutter cells while annotating review comments', async () => {
    document.body.innerHTML = `
      <main>
        <article class="comment-body">
          <p>The meticulous review comment remains readable.</p>
        </article>
        <table class="diff-table">
          <tbody>
            <tr>
              <td class="blob-num">The meticulous line number should stay untouched.</td>
              <td class="blob-code"><span class="blob-code-inner">The meticulous diff code should stay untouched.</span></td>
            </tr>
            <tr class="diff-line-row">
              <td class="diff-line-num">The meticulous diff gutter should stay untouched.</td>
              <td class="diff-line-code">The meticulous unified diff code should stay untouched.</td>
            </tr>
          </tbody>
        </table>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('.comment-body [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.blob-num [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.blob-code [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.diff-line-num [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.diff-line-code [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips code-viewer virtual lines while keeping adjacent prose readable', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous explanation paragraph remains readable.</p>
        </article>
        <div class="react-code-lines">
          <div class="react-code-text">The meticulous virtual code line should stay untouched.</div>
          <div class="js-file-line">The meticulous legacy file line should stay untouched.</div>
        </div>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.react-code-lines [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.js-file-line [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips lazily inserted GitHub diff file containers after the page is already scanned', async () => {
    document.body.innerHTML = `
      <main>
        <article class="markdown-body">
          <p>The meticulous pull request comment remains readable.</p>
        </article>
        <section id="files"></section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const files = document.querySelector('#files') as HTMLElement;
    expect(document.querySelector('.markdown-body [data-qianci-word="meticulous"]')).not.toBeNull();

    files.innerHTML = `
      <div class="js-file">
        <div class="file-header">The meticulous file header should stay untouched.</div>
        <div class="js-diff-progressive-container">
          <div data-hunk="@@">
            <div class="blob-num">The meticulous lazy gutter should stay untouched.</div>
            <div class="blob-code">The meticulous lazy diff should stay untouched.</div>
          </div>
        </div>
        <article class="comment-body markdown-body">
          <p>The meticulous inline review comment remains readable.</p>
        </article>
      </div>
    `;
    await Promise.resolve();
    await flushScanWork();

    expect(files.querySelector('.file-header [data-qianci-word]')).toBeNull();
    expect(files.querySelector('.js-diff-progressive-container [data-qianci-word]')).toBeNull();
    expect(files.querySelector('[data-hunk] [data-qianci-word]')).toBeNull();
    expect(files.querySelector('.comment-body [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
