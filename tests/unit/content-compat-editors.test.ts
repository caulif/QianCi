import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility editors', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by editor compatibility tests.
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
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips code blocks and rich editor containers while annotating prose', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous documentation paragraph remains readable.</p>
          <pre><code>The meticulous code example should stay untouched.</code></pre>
          <div class="monaco-editor">The meticulous monaco line should stay untouched.</div>
          <div class="cm-editor">The meticulous codemirror line should stay untouched.</div>
          <div class="CodeMirror">The meticulous legacy codemirror line should stay untouched.</div>
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
    expect(document.querySelector('pre [data-qianci-word]')).toBeNull();
    expect(document.querySelector('code [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.monaco-editor [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.cm-editor [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.CodeMirror [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('looks up a real contenteditable selection without rewriting editor DOM', async () => {
    document.body.innerHTML = `
      <main>
        <div id="editor" contenteditable="true">
          Draft <strong>serendipity</strong> remains editable.
        </div>
      </main>
    `;
    const dictionary = {
      serendipity: { word: 'serendipity', phonetic: '/ˌserənˈdɪpəti/', translation: '意外发现的美好', rank: 12300 }
    };
    const onLookup = vi.fn();
    const editor = document.querySelector('#editor') as HTMLElement;
    const selectedText = editor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('Missing editable selection text');
    }
    const beforeHtml = editor.innerHTML;
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 40, top: 80, width: 96, height: 18 })
    });
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const app = createContentApp(document, {
      profile: createProfile('professional'),
      ranks: { serendipity: 12300 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    app.rescan();
    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await Promise.resolve();

    expect(onLookup).toHaveBeenCalledWith(
      'serendipity',
      'selection',
      expect.objectContaining({ level: 'professional' }),
      expect.objectContaining({ translation: '意外发现的美好' })
    );
    expect(editor.innerHTML).toBe(beforeHtml);
    expect(editor.querySelector('[data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
