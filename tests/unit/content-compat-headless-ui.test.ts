import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility headless ui states', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by headless UI compatibility tests.
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
   * Creates a content app with common headless component service stubs.
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

  it('skips mounted Headless UI transition panels until they become open prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section id="headless-panel" data-closed data-leave>
          The meticulous disclosure body should stay untouched while closing.
        </section>
        <section id="legacy-headless-panel" data-headlessui-state="closed">
          The meticulous legacy disclosure body should stay untouched.
        </section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const panel = document.querySelector('#headless-panel') as HTMLElement;
    const legacyPanel = document.querySelector('#legacy-headless-panel') as HTMLElement;
    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(panel.querySelector('[data-qianci-word]')).toBeNull();
    expect(legacyPanel.querySelector('[data-qianci-word]')).toBeNull();

    panel.removeAttribute('data-closed');
    panel.removeAttribute('data-leave');
    legacyPanel.setAttribute('data-headlessui-state', 'open');
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(legacyPanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('cleans annotations when an open headless panel enters the closed transition state', async () => {
    document.body.innerHTML = `
      <main>
        <section id="headless-panel">
          The meticulous disclosure body starts as readable.
        </section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const panel = document.querySelector('#headless-panel') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();

    panel.setAttribute('data-closed', '');
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word]')).toBeNull();
    expect(panel.textContent).toContain('The meticulous disclosure body starts as readable.');
    app.dispose();
  });

  it('skips page-owned tooltip and floating-ui portal content', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <div id="native-tooltip" role="tooltip">The meticulous tooltip content should stay untouched.</div>
        <div id="floating-portal" data-floating-ui-portal>
          <div role="tooltip">The meticulous floating tooltip should stay untouched.</div>
        </div>
        <div id="radix-popper" data-radix-popper-content-wrapper>
          <div data-side="top">The meticulous positioned popper should stay untouched.</div>
        </div>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('#native-tooltip [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#floating-portal [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#radix-popper [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
