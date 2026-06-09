import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility computed hidden selectors', () => {
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
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips selector-only computed hidden regions until they become visible', async () => {
    document.head.innerHTML = '<style>[data-selector-hidden] { display: none; }</style>';
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section id="selector-hidden-panel" data-selector-hidden>
          The meticulous selector hidden panel appears later.
        </section>
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

    const hiddenPanel = document.querySelector('#selector-hidden-panel') as HTMLElement;
    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(hiddenPanel.querySelector('[data-qianci-word]')).toBeNull();

    hiddenPanel.removeAttribute('data-selector-hidden');
    await Promise.resolve();
    await flushScanWork();

    expect(hiddenPanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips zero-size overflow hidden regions until they become measurable', async () => {
    document.head.innerHTML = '<style>.measurement-row { height: 0; overflow: hidden; }</style>';
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section id="measurement-row" class="measurement-row">
          The meticulous measurement row appears later.
        </section>
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

    const measurementRow = document.querySelector('#measurement-row') as HTMLElement;
    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(measurementRow.querySelector('[data-qianci-word]')).toBeNull();

    measurementRow.classList.remove('measurement-row');
    await Promise.resolve();
    await flushScanWork();

    expect(measurementRow.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
