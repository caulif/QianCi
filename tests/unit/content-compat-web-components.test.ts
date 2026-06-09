import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility web components', () => {
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
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips unassigned light DOM children of shadow hosts', async () => {
    document.body.innerHTML = `
      <article>
        <no-slot-reader id="no-slot-host">
          <p>The meticulous unassigned light text is not rendered.</p>
        </no-slot-reader>
      </article>
    `;

    const host = document.querySelector('#no-slot-host') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<p>The meticulous shadow text is visible.</p>';

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

    expect(shadowRoot.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(host.querySelector('[data-qianci-word]')).toBeNull();
    expect(host.textContent).toContain('The meticulous unassigned light text is not rendered.');
    app.dispose();
  });

  it('updates slot fallback when assigned nodes are added or removed', async () => {
    document.body.innerHTML = '<article><dynamic-slot-reader id="dynamic-slot-host"></dynamic-slot-reader></article>';

    const host = document.querySelector('#dynamic-slot-host') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <section>
        <slot name="body">The meticulous dynamic fallback text is visible.</slot>
      </section>
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

    expect(shadowRoot.querySelector('slot [data-qianci-word="meticulous"]')).not.toBeNull();

    const assignedParagraph = document.createElement('p');
    assignedParagraph.slot = 'body';
    assignedParagraph.textContent = 'The meticulous dynamic assigned text is visible.';
    host.append(assignedParagraph);
    await Promise.resolve();
    await flushScanWork();

    expect(assignedParagraph.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(shadowRoot.querySelector('slot [data-qianci-word]')).toBeNull();

    assignedParagraph.remove();
    await Promise.resolve();
    await flushScanWork();

    expect(shadowRoot.querySelector('slot [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
