import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility accessible names', () => {
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

  it('does not rewrite external text referenced by interactive controls', async () => {
    document.body.innerHTML = `
      <main>
        <article>
          <p>The meticulous article paragraph remains readable.</p>
        </article>
        <button aria-labelledby="save-label"></button>
        <span id="save-label">The meticulous save command name should stay untouched.</span>
        <input aria-describedby="field-hint">
        <p id="field-hint">The meticulous input description should stay untouched.</p>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('article [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('#save-label [data-qianci-word]')).toBeNull();
    expect(document.querySelector('#field-hint [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('annotates formerly referenced helper text after controls stop using it', async () => {
    document.body.innerHTML = `
      <main>
        <button id="action" aria-labelledby="action-label"></button>
        <span id="action-label">The meticulous command name becomes prose later.</span>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const action = document.querySelector('#action') as HTMLElement;
    const label = document.querySelector('#action-label') as HTMLElement;
    expect(label.querySelector('[data-qianci-word]')).toBeNull();

    action.removeAttribute('aria-labelledby');
    await Promise.resolve();
    await flushScanWork();

    expect(label.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('handles multiple idrefs, errormessage, shared descriptions, and target switching', async () => {
    document.body.innerHTML = `
      <main>
        <button id="multi-action" aria-labelledby="primary-label secondary-label"></button>
        <span id="primary-label">The meticulous primary label should stay untouched.</span>
        <span id="secondary-label">The meticulous secondary label should stay untouched.</span>
        <input id="field-one" aria-describedby="shared-hint" aria-errormessage="field-error">
        <input id="field-two" aria-describedby="shared-hint">
        <p id="shared-hint">The meticulous shared hint should stay untouched.</p>
        <p id="field-error">The meticulous field error should stay untouched.</p>
        <p id="new-label">The meticulous new label starts as readable prose.</p>
      </main>
    `;

    const app = createCompatibilityApp();
    app.rescan();
    await flushScanWork();

    const action = document.querySelector('#multi-action') as HTMLElement;
    const fieldOne = document.querySelector('#field-one') as HTMLElement;
    const fieldTwo = document.querySelector('#field-two') as HTMLElement;
    const primaryLabel = document.querySelector('#primary-label') as HTMLElement;
    const secondaryLabel = document.querySelector('#secondary-label') as HTMLElement;
    const sharedHint = document.querySelector('#shared-hint') as HTMLElement;
    const fieldError = document.querySelector('#field-error') as HTMLElement;
    const newLabel = document.querySelector('#new-label') as HTMLElement;
    expect(primaryLabel.querySelector('[data-qianci-word]')).toBeNull();
    expect(secondaryLabel.querySelector('[data-qianci-word]')).toBeNull();
    expect(sharedHint.querySelector('[data-qianci-word]')).toBeNull();
    expect(fieldError.querySelector('[data-qianci-word]')).toBeNull();
    expect(newLabel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();

    action.setAttribute('aria-labelledby', 'new-label');
    fieldOne.removeAttribute('aria-errormessage');
    fieldOne.removeAttribute('aria-describedby');
    await Promise.resolve();
    await flushScanWork();

    expect(primaryLabel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(secondaryLabel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(newLabel.querySelector('[data-qianci-word]')).toBeNull();
    expect(fieldError.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(sharedHint.querySelector('[data-qianci-word]')).toBeNull();

    fieldTwo.removeAttribute('aria-describedby');
    await Promise.resolve();
    await flushScanWork();

    expect(sharedHint.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
