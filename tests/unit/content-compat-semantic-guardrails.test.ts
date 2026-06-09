import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility semantic guardrails', () => {
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

  /**
   * Creates a content app with the common compatibility-test service stubs.
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

  it('respects translate opt-out regions while still annotating article prose', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section translate="no">The meticulous product name should stay untouched.</section>
        <section class="notranslate">The meticulous machine label should stay untouched.</section>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('[translate="no"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.notranslate [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips math renderer and ruby annotation subtrees that should not be rewritten', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <span class="katex">The meticulous formula renderer should stay untouched.</span>
        <mjx-container>The meticulous MathJax renderer should stay untouched.</mjx-container>
        <ruby>漢<rt>The meticulous ruby annotation should stay untouched.</rt></ruby>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.katex [data-qianci-word]')).toBeNull();
    expect(document.querySelector('mjx-container [data-qianci-word]')).toBeNull();
    expect(document.querySelector('rt [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('skips busy and complex aria widget containers until they are readable prose again', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <section id="busy-panel" aria-busy="true">The meticulous loading copy appears later.</section>
        <div role="progressbar">The meticulous progress label should stay untouched.</div>
        <div role="toolbar">The meticulous toolbar command should stay untouched.</div>
        <div role="tree">The meticulous tree item should stay untouched.</div>
        <div role="grid">The meticulous data grid cell should stay untouched.</div>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const busyPanel = document.querySelector('#busy-panel') as HTMLElement;
    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(busyPanel.querySelector('[data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="progressbar"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="toolbar"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="tree"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="grid"] [data-qianci-word]')).toBeNull();

    busyPanel.setAttribute('aria-busy', 'false');
    await Promise.resolve();
    await flushScanWork();

    expect(busyPanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
