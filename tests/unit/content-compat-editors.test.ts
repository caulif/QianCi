import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility editors', () => {
  /**
   * Creates a dictionary resolver used by editor compatibility tests.
   *
   * @param dictionary Entries keyed by normalized word.
   * @returns Async resolver matching the content app service contract.
   */
  function createResolver(dictionary: Record<string, DictionaryEntry>) {
    return async (word: string) => dictionary[word];
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
