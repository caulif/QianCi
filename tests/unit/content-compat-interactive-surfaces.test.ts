import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility interactive surfaces', () => {
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

  it('skips compact custom controls but annotates large onclick prose containers (G5)', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <div id="onclick-card" class="feed-card" onclick="window.cardClicked = true">
          <p>The meticulous product story lives inside a large clickable feed card and should still be annotated for reading.</p>
        </div>
        <div id="tabindex-chip" tabindex="0" class="chip">Open</div>
        <div id="menu-trigger" aria-haspopup="menu">The meticulous menu trigger should stay untouched.</div>
        <span id="action-chip" data-action="open-menu">Open menu</span>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    // Large clickable card with block prose: body text may be annotated.
    expect(document.querySelector('#onclick-card [data-qianci-word="meticulous"]')).not.toBeNull();
    // Compact chip / menu / action control: still skipped.
    expect(document.querySelector('#tabindex-chip [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#menu-trigger [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#action-chip [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('keeps passive prose with negative tabindex readable', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p tabindex="-1">The meticulous focus target paragraph remains readable.</p>
        </article>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('keeps words inside native links annotatable even when links have inline handlers', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <a href="/next" onclick="window.linkClicked = true">Read the meticulous guide.</a>
        </article>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('a [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
