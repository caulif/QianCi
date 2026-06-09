import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility commerce pages', () => {
  const RESCAN_DELAY_MS = 24;

  /**
   * Creates a dictionary resolver used by commerce compatibility tests.
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

  it('skips product commerce controls and metadata while reading descriptions and reviews', async () => {
    document.body.innerHTML = `
      <main>
        <article class="product">
          <nav class="breadcrumb">The meticulous product breadcrumb should stay untouched.</nav>
          <header class="product-meta">
            <p class="sku" itemprop="sku">The meticulous SKU label should stay untouched.</p>
            <p class="price" itemprop="price">The meticulous product price should stay untouched.</p>
            <p class="rating" aria-label="4.8 rating">The meticulous rating summary should stay untouched.</p>
          </header>
          <section class="product-description">
            <p>The meticulous product description remains readable.</p>
          </section>
          <form class="product-form">
            <fieldset class="variant-picker">
              <legend>The meticulous variant label should stay untouched.</legend>
              <label>The meticulous size option should stay untouched.</label>
            </fieldset>
            <div class="quantity-selector">The meticulous quantity selector should stay untouched.</div>
            <button class="add-to-cart">The meticulous add to cart copy should stay untouched.</button>
          </form>
          <aside class="shipping-info">The meticulous shipping promise should stay untouched.</aside>
          <aside class="coupon promotion">The meticulous coupon text should stay untouched.</aside>
          <section class="reviews">
            <article class="review">
              <p class="review-body">The meticulous review body remains readable.</p>
              <p itemprop="ratingValue">The meticulous review score should stay untouched.</p>
            </article>
          </section>
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

    expect(document.querySelector('.product-description [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.review-body [data-qianci-word="meticulous"]')).not.toBeNull();
    expect(document.querySelector('.breadcrumb [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.product-meta [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.sku [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.price [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.rating [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.product-form [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.variant-picker [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.quantity-selector [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.shipping-info [data-qianci-word]')).toBeNull();
    expect(document.querySelector('.coupon [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[itemprop="ratingValue"] [data-qianci-word]')).toBeNull();
    app.dispose();
  });
});
