import type { Page } from 'playwright';

/**
 * Counts annotated words inside several page selectors.
 *
 * @param page Playwright page used by the smoke run.
 * @param selectors Selectors whose descendants must not contain annotations.
 * @returns Annotation counts ordered like the input selectors.
 */
export async function annotationCounts(page: Page, selectors: string[]): Promise<number[]> {
  const counts: number[] = [];
  for (const selector of selectors) {
    counts.push(await page.locator(`${selector} [data-qianci-word]`).count());
  }
  return counts;
}

/**
 * Verifies that selectors contain no QianCi annotations.
 *
 * @param page Playwright page used by the smoke run.
 * @param label Human-readable failure label.
 * @param selectors Selectors whose descendants must not contain annotations.
 * @returns Promise resolved when all selectors are clean.
 */
export async function assertNoAnnotations(page: Page, label: string, selectors: string[]): Promise<void> {
  const counts = await annotationCounts(page, selectors);
  if (counts.some((count) => count !== 0)) {
    throw new Error(`${label} should not be annotated: ${counts.join('/')}`);
  }
}

/**
 * Waits for a visible annotated word inside a stable page selector.
 *
 * @param page Playwright page used by the smoke run.
 * @param selector Container selector that should contain the annotation.
 * @param word Normalized QianCi word expected inside the container.
 * @returns Promise resolved when the annotated word is visible.
 */
export async function waitForAnnotatedWord(page: Page, selector: string, word: string): Promise<void> {
  await page.locator(`${selector} [data-qianci-word="${word}"]`).waitFor({
    state: 'visible',
    timeout: 10_000
  });
}
