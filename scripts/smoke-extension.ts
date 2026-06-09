import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { assertNoAnnotations, waitForAnnotatedWord } from './smoke-assertions';
import { compatibilitySmokeHtml, defaultSmokeHtml } from './smoke-pages';

interface BuiltManifest {
  content_scripts?: Array<{ all_frames?: boolean }>;
  web_accessible_resources?: Array<{ resources?: string[] }>;
}

interface SmokeServer {
  url: string;
  compatUrl: string;
  close: () => Promise<void>;
}

const MAX_CONTENT_BUNDLE_BYTES = 650 * 1024;
const MAX_INITIAL_CONTENT_ASSET_BYTES = 2 * 1024 * 1024;

function findContentBundle(manifest: BuiltManifest): string {
  const resources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources ?? []) ?? [];
  const contentBundle = resources.find((resource) => /^assets\/index\.ts-.*\.js$/.test(resource));
  if (!contentBundle) {
    throw new Error('Could not find built content script bundle in manifest resources');
  }
  return contentBundle;
}

function findRankIndexResource(manifest: BuiltManifest): string {
  const resources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources ?? []) ?? [];
  const rankIndexResource = resources.find((resource) => /^assets\/rank\.generated-.*\.json$/.test(resource));
  if (!rankIndexResource) {
    throw new Error('Could not find built rank index resource in manifest resources');
  }
  return rankIndexResource;
}

/**
 * Verifies the production manifest keeps the default top-frame-only policy.
 *
 * @param manifest Built extension manifest from dist.
 * @returns Nothing.
 */
function assertTopFrameOnlyManifest(manifest: BuiltManifest): void {
  if (manifest.content_scripts?.some((script) => script.all_frames === true)) {
    throw new Error('Built manifest should not inject QianCi into every frame by default');
  }
}

async function assertContentBundleBudget(distDir: string, contentBundle: string): Promise<void> {
  const contentBundleStat = await stat(resolve(distDir, contentBundle));
  if (contentBundleStat.size > MAX_CONTENT_BUNDLE_BYTES) {
    throw new Error(
      `Content script bundle is too large: ${contentBundleStat.size} bytes exceeds ${MAX_CONTENT_BUNDLE_BYTES} bytes`
    );
  }
}

async function assertInitialContentAssetBudget(
  distDir: string,
  contentBundle: string,
  rankIndexResource: string
): Promise<void> {
  const [contentBundleStat, rankIndexStat] = await Promise.all([
    stat(resolve(distDir, contentBundle)),
    stat(resolve(distDir, rankIndexResource))
  ]);
  const initialBytes = contentBundleStat.size + rankIndexStat.size;
  if (initialBytes > MAX_INITIAL_CONTENT_ASSET_BYTES) {
    throw new Error(
      `Initial content assets are too large: ${initialBytes} bytes exceeds ${MAX_INITIAL_CONTENT_ASSET_BYTES} bytes`
    );
  }
}

async function findServiceWorkerBundle(): Promise<string> {
  const loader = readFile(resolve(process.cwd(), 'dist', 'service-worker-loader.js'), 'utf8');
  const text = await loader;
  const match = text.match(/assets\/[^"'`]+\.js/);
  if (!match) {
    throw new Error('Could not find built service worker bundle');
  }
  return match[0];
}

function contentType(pathname: string): string {
  if (extname(pathname) === '.js') {
    return 'text/javascript; charset=utf-8';
  }
  if (extname(pathname) === '.json') {
    return 'application/json; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}

async function startServer(distDir: string, contentBundle: string): Promise<SmokeServer> {
  const html = defaultSmokeHtml(contentBundle);
  const compatHtml = compatibilitySmokeHtml(contentBundle);
  const server = createServer(async (req, res) => {
    if ((req.url ?? '/') === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if ((req.url ?? '/') === '/compat') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(compatHtml);
      return;
    }
    if ((req.url ?? '').startsWith('/assets/')) {
      try {
        const file = await readFile(resolve(distDir, `.${req.url}`));
        res.writeHead(200, { 'content-type': contentType(req.url ?? '') });
        res.end(file);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start smoke server');
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    compatUrl: `http://127.0.0.1:${address.port}/compat`,
    close: async () =>
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      })
  };
}

/**
 * Verifies the baseline hover lookup scenario in a production content bundle.
 *
 * @param page Playwright page used for the smoke run.
 * @param url Local smoke page URL.
 * @returns Promise resolved when baseline annotations and tooltip pass.
 */
async function assertBaselineLookup(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  console.log('Waiting for annotation...');

  const annotated = page.locator('[data-qianci-word="unobtrusive"]');
  await annotated.waitFor({ state: 'visible', timeout: 10_000 });
  const count = await annotated.count();
  if (count !== 1) {
    throw new Error(`Expected one annotated word, got ${count}`);
  }

  console.log('Hovering...');
  await annotated.hover({ timeout: 10_000 });
  const tooltip = page.locator('[data-qianci-tooltip]');
  await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
  const text = await tooltip.evaluate((element) => element.shadowRoot?.textContent ?? element.textContent ?? '');
  if (!text.includes('不唐突的')) {
    throw new Error(`Tooltip text missing translation: ${text}`);
  }
}

/**
 * Verifies link clicks and skipped interactive regions against a production bundle.
 *
 * @param page Playwright page used for the smoke run.
 * @param compatUrl Local compatibility smoke page URL.
 * @returns Promise resolved when compatibility checks pass.
 */
async function assertCompatibilityLookup(page: Page, compatUrl: string): Promise<void> {
  await page.goto(compatUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  console.log('Checking compatibility page...');

  const articleWord = page.locator('#main-article-paragraph [data-qianci-word="meticulous"]');
  await articleWord.waitFor({ state: 'visible', timeout: 10_000 });
  const landmarkAnnotatedCounts = [
    await page.locator('#site-nav [data-qianci-word]').count(),
    await page.locator('#breadcrumb [data-qianci-word]').count(),
    await page.locator('#page-footer [data-qianci-word]').count(),
    await page.locator('#page-contentinfo [data-qianci-word]').count()
  ];
  if (landmarkAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`Navigation and footer landmarks should not be annotated: ${landmarkAnnotatedCounts.join('/')}`);
  }
  const articleNoiseAnnotatedCounts = [
    await page.locator('#article-meta [data-qianci-word]').count(),
    await page.locator('#article-toc [data-qianci-word]').count(),
    await page.locator('#share-bar [data-qianci-word]').count(),
    await page.locator('#ad-slot [data-qianci-word]').count(),
    await page.locator('#related-posts [data-qianci-word]').count()
  ];
  if (articleNoiseAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`Article noise regions should not be annotated: ${articleNoiseAnnotatedCounts.join('/')}`);
  }
  const editorAnnotatedCounts = [
    await page.locator('#code-sample [data-qianci-word]').count(),
    await page.locator('#monaco-surface [data-qianci-word]').count(),
    await page.locator('#codemirror-surface [data-qianci-word]').count(),
    await page.locator('#github-diff-sample [data-qianci-word]').count(),
    await page.locator('#github-code-view [data-qianci-word]').count()
  ];
  if (editorAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`Code and editor regions should not be annotated: ${editorAnnotatedCounts.join('/')}`);
  }
  const highDensityNoiseAnnotatedCounts = [
    await page.locator('#mdn-layout-sample .left-sidebar [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .breadcrumbs [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .reference-toc [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .layout__right-sidebar [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .metadata [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .bc-table [data-qianci-word]').count(),
    await page.locator('#mdn-layout-sample .article-footer [data-qianci-word]').count(),
    await page.locator('#pdfjs-sample .textLayer [data-qianci-word]').count(),
    await page.locator('#pdfjs-sample .annotationLayer [data-qianci-word]').count(),
    await page.locator('#pdfjs-sample .xfaLayer [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample .ltx_authors [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample .ltx_ref [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample .citation [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample .ltx_tag_equation [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample [role="doc-footnote"] [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample .footnotes [data-qianci-word]').count(),
    await page.locator('#academic-paper-sample [role="doc-bibliography"] [data-qianci-word]').count(),
    await page.locator('#search-results-sample form[role="search"] [data-qianci-word]').count(),
    await page.locator('#search-results-sample .result__url [data-qianci-word]').count(),
    await page.locator('#search-results-sample .result__extras [data-qianci-word]').count(),
    await page.locator('#search-results-sample .result__sitelinks [data-qianci-word]').count(),
    await page.locator('#search-results-sample .result--ad [data-qianci-word]').count(),
    await page.locator('#search-results-sample .people-also-ask [data-qianci-word]').count(),
    await page.locator('#search-results-sample .related-searches [data-qianci-word]').count(),
    await page.locator('#search-results-sample .pagination [data-qianci-word]').count()
  ];
  if (highDensityNoiseAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`High-density page noise should not be annotated: ${highDensityNoiseAnnotatedCounts.join('/')}`);
  }
  await assertNoAnnotations(page, 'Commerce controls and metadata', [
    '#commerce-product .breadcrumb',
    '#commerce-product .product-meta',
    '#commerce-product .product-form',
    '#commerce-product .product-actions',
    '#commerce-product .shipping-info',
    '#commerce-product .coupon',
    '#commerce-product [itemprop="ratingValue"]'
  ]);
  await waitForAnnotatedWord(page, '#commerce-product .product-description', 'meticulous');
  await waitForAnnotatedWord(page, '#commerce-product .review-body', 'meticulous');
  await page.locator('#search-results-sample .result__title [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  await page.locator('#search-results-sample .result__snippet [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  await page.locator('#pdfjs-sample > p [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  await page.locator('#academic-paper-sample .abstract [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  await page.locator('#academic-paper-sample > p [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  await page.locator('#academic-citation-popups').evaluate((popups) => {
    popups.innerHTML = `
      <span class="tippy-box citation-tooltip" role="tooltip">
        The meticulous citation preview should stay untouched.
      </span>
    `;
  });
  await page.waitForFunction(() => document.querySelector('#academic-citation-popups .citation-tooltip'));
  const citationPopupAnnotations = await page.locator('#academic-citation-popups [data-qianci-word]').count();
  if (citationPopupAnnotations !== 0) {
    throw new Error(`Lazy citation popup should not be annotated, got ${citationPopupAnnotations}`);
  }
  await page.locator('#lazy-pdf-page').evaluate((pageRoot) => {
    pageRoot.innerHTML = `
      <div class="page" data-page-number="2">
        <div class="textLayer">
          <span>The meticulous lazy PDF text layer should stay untouched.</span>
        </div>
      </div>
    `;
  });
  await page.waitForFunction(() => document.querySelector('#lazy-pdf-page .textLayer'));
  const lazyPdfAnnotations = await page.locator('#lazy-pdf-page [data-qianci-word]').count();
  if (lazyPdfAnnotations !== 0) {
    throw new Error(`Lazy PDF.js text layer should not be annotated, got ${lazyPdfAnnotations}`);
  }
  await page.locator('#github-lazy-files').evaluate((files) => {
    files.innerHTML = `
      <div class="js-file">
        <div class="file-header">The meticulous lazy file header should stay untouched.</div>
        <div class="js-diff-progressive-container">
          <div data-hunk="@@">
            <div class="blob-num">The meticulous lazy gutter should stay untouched.</div>
            <div class="blob-code">The meticulous lazy diff should stay untouched.</div>
          </div>
        </div>
      </div>
    `;
  });
  await page.waitForFunction(() => document.querySelector('#github-lazy-files .js-file'));
  const lazyGitHubAnnotated = await page.locator('#github-lazy-files [data-qianci-word]').count();
  if (lazyGitHubAnnotated !== 0) {
    throw new Error(`Lazy GitHub diff should not be annotated, got ${lazyGitHubAnnotated}`);
  }
  await page.locator('#search-results-sample').evaluate((container) => {
    const insertedAd = document.createElement('article');
    insertedAd.className = 'result result--ad';
    insertedAd.textContent = 'The meticulous inserted ad should stay untouched.';
    const result = container.querySelector('.result:not(.result--ad)');
    container.prepend(insertedAd);
    if (result) {
      container.append(result);
    }
    const snippet = container.querySelector('.result__snippet');
    if (snippet) {
      snippet.textContent = 'The meticulous updated search snippet remains readable.';
    }
  });
  await page.waitForFunction(() => {
    const container = document.querySelector('#search-results-sample');
    if (!container) {
      return false;
    }
    const insertedAd = container.querySelector('.result--ad');
    const snippet = container.querySelector('.result__snippet');
    return (
      insertedAd?.querySelectorAll('[data-qianci-word]').length === 0 &&
      snippet?.querySelectorAll('[data-qianci-word="meticulous"]').length === 1 &&
      !snippet?.querySelector('[data-qianci-word] [data-qianci-word]')
    );
  });
  const liveRegionAnnotatedCounts = [
    await page.locator('#polite-live [data-qianci-word]').count(),
    await page.locator('#status-toast [data-qianci-word]').count(),
    await page.locator('#alert-toast [data-qianci-word]').count()
  ];
  if (liveRegionAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`Live regions should not start annotated: ${liveRegionAnnotatedCounts.join('/')}`);
  }
  const semanticGuardAnnotatedCounts = [
    await page.locator('#translate-no [data-qianci-word]').count(),
    await page.locator('#notranslate [data-qianci-word]').count(),
    await page.locator('#katex-renderer [data-qianci-word]').count(),
    await page.locator('#mathjax-renderer [data-qianci-word]').count(),
    await page.locator('#ruby-copy rt [data-qianci-word]').count(),
    await page.locator('#busy-panel [data-qianci-word]').count(),
    await page.locator('#toolbar-widget [data-qianci-word]').count(),
    await page.locator('#grid-widget [data-qianci-word]').count(),
    await page.locator('#named-action-label [data-qianci-word]').count(),
    await page.locator('#described-input-hint [data-qianci-word]').count(),
    await page.locator('#onclick-card [data-qianci-word]').count(),
    await page.locator('#tabindex-card [data-qianci-word]').count(),
    await page.locator('#menu-trigger [data-qianci-word]').count(),
    await page.locator('#action-chip [data-qianci-word]').count()
  ];
  if (semanticGuardAnnotatedCounts.some((count) => count !== 0)) {
    throw new Error(`Semantic guard regions should not start annotated: ${semanticGuardAnnotatedCounts.join('/')}`);
  }
  await page.locator('#polite-live').evaluate((region) => {
    region.removeAttribute('aria-live');
  });
  await page.locator('#polite-live [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#busy-panel').evaluate((panel) => {
    panel.setAttribute('aria-busy', 'false');
  });
  await page.locator('#busy-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#named-action').evaluate((button) => {
    button.removeAttribute('aria-labelledby');
  });
  await page.locator('#named-action-label [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  const headerAdjacentWord = page.locator('.near-fixed-header-word [data-qianci-word="meticulous"]');
  await headerAdjacentWord.click({ timeout: 10_000 });
  await page.locator('[data-qianci-tooltip]').waitFor({ state: 'visible', timeout: 10_000 });
  const tooltipOverlapsHeader = await page.evaluate(() => {
    const header = document.querySelector('#fixed-smoke-header');
    const tooltip = document.querySelector('[data-qianci-tooltip]');
    if (!(header instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) {
      throw new Error('Missing fixed header or tooltip for occlusion check');
    }

    const headerRect = header.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    return !(
      tooltipRect.bottom <= headerRect.top ||
      tooltipRect.top >= headerRect.bottom ||
      tooltipRect.right <= headerRect.left ||
      tooltipRect.left >= headerRect.right
    );
  });
  if (tooltipOverlapsHeader) {
    throw new Error('Tooltip should not overlap the fixed smoke header');
  }
  await page.setViewportSize({ width: 260, height: 900 });
  const footerAdjacentWord = page.locator('.near-fixed-footer-word [data-qianci-word="meticulous"]');
  await footerAdjacentWord.click({ timeout: 10_000 });
  await page.locator('[data-qianci-tooltip]').waitFor({ state: 'visible', timeout: 10_000 });
  const tooltipOverlapsFooter = await page.evaluate(() => {
    const footer = document.querySelector('#fixed-smoke-footer');
    const tooltip = document.querySelector('[data-qianci-tooltip]');
    if (!(footer instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) {
      throw new Error('Missing fixed footer or tooltip for occlusion check');
    }

    const footerRect = footer.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    return !(
      tooltipRect.bottom <= footerRect.top ||
      tooltipRect.top >= footerRect.bottom ||
      tooltipRect.right <= footerRect.left ||
      tooltipRect.left >= footerRect.right
    );
  });
  if (tooltipOverlapsFooter) {
    throw new Error('Tooltip should not overlap the fixed smoke footer');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#late-shadow-host').evaluate((host) => {
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>The meticulous late shadow body appears.</p>';
  });
  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#late-shadow-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('[data-qianci-word="meticulous"]').length === 1;
  });
  const dynamicIgnoredWord = page.locator('#dynamic-ignore [data-qianci-word="meticulous"]');
  await dynamicIgnoredWord.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#dynamic-ignore').evaluate((element) => {
    element.classList.add('qianci-ignore');
  });
  await page.waitForFunction(() => document.querySelector('#dynamic-ignore [data-qianci-word]') === null);
  const hiddenStyleAnnotated = await page.locator('#style-hidden [data-qianci-word]').count();
  if (hiddenStyleAnnotated !== 0) {
    throw new Error(`Inline style hidden content should not be annotated, got ${hiddenStyleAnnotated}`);
  }
  const styleRestoreAnnotated = await page.locator('#style-restore [data-qianci-word]').count();
  if (styleRestoreAnnotated !== 0) {
    throw new Error(`Restorable hidden style content should not start annotated, got ${styleRestoreAnnotated}`);
  }
  await page.locator('#style-restore').evaluate((panel) => {
    (panel as HTMLElement).style.display = '';
  });
  await page.locator('#style-restore [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const classHiddenAnnotated = await page.locator('#class-hidden [data-qianci-word]').count();
  if (classHiddenAnnotated !== 0) {
    throw new Error(`Class hidden content should not start annotated, got ${classHiddenAnnotated}`);
  }
  await page.locator('#class-hidden').evaluate((panel) => {
    panel.classList.remove('d-none');
  });
  await page.locator('#class-hidden [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const bootstrapA11yAnnotated = await page.locator('#bootstrap-a11y [data-qianci-word]').count();
  const tailwindA11yAnnotated = await page.locator('#tailwind-a11y [data-qianci-word]').count();
  if (bootstrapA11yAnnotated !== 0 || tailwindA11yAnnotated !== 0) {
    throw new Error(
      `Screen-reader-only text should not start annotated: ${bootstrapA11yAnnotated}/${tailwindA11yAnnotated}`
    );
  }
  await page.locator('#bootstrap-a11y').evaluate((label) => {
    label.classList.remove('visually-hidden');
  });
  await page.locator('#tailwind-a11y').evaluate((label) => {
    label.classList.remove('sr-only');
  });
  await page.locator('#bootstrap-a11y [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#tailwind-a11y [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const computedHiddenSelectors = [
    '#css-invisible',
    '#css-transparent',
    '#css-content-hidden',
    '#css-selector-hidden',
    '#measurement-row',
    '#scale-hidden-panel',
    '#zero-box-panel',
    '#css-offscreen',
    '#css-clipped'
  ];
  for (const selector of computedHiddenSelectors) {
    const annotatedCount = await page.locator(`${selector} [data-qianci-word]`).count();
    if (annotatedCount !== 0) {
      throw new Error(`Computed hidden region ${selector} should not start annotated, got ${annotatedCount}`);
    }
  }
  await page.locator('#css-invisible').evaluate((panel) => {
    panel.classList.remove('css-invisible');
  });
  await page.locator('#css-transparent').evaluate((panel) => {
    panel.classList.remove('css-transparent');
  });
  await page.locator('#css-content-hidden').evaluate((panel) => {
    panel.classList.remove('css-content-hidden');
  });
  await page.locator('#css-selector-hidden').evaluate((panel) => {
    panel.removeAttribute('data-selector-hidden');
  });
  await page.locator('#measurement-row').evaluate((panel) => {
    panel.classList.remove('measurement-row');
  });
  await page.locator('#scale-hidden-panel').evaluate((panel) => {
    panel.classList.remove('scale-hidden');
  });
  await page.locator('#zero-box-panel').evaluate((panel) => {
    panel.classList.remove('zero-box-hidden');
  });
  await page.locator('#css-offscreen').evaluate((panel) => {
    panel.classList.remove('css-offscreen');
  });
  await page.locator('#css-clipped').evaluate((panel) => {
    panel.classList.remove('css-clipped');
  });
  for (const selector of computedHiddenSelectors) {
    await page.locator(`${selector} [data-qianci-word="meticulous"]`).waitFor({ state: 'visible', timeout: 10_000 });
  }

  const closedDetailsAnnotated = await page.locator('#details-panel p [data-qianci-word]').count();
  if (closedDetailsAnnotated !== 0) {
    throw new Error(`Closed details body should not be annotated, got ${closedDetailsAnnotated}`);
  }
  await page.locator('#details-panel').evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
  });
  await page.locator('#details-panel p [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const closedDialogAnnotated = await page.locator('#dialog-panel [data-qianci-word]').count();
  if (closedDialogAnnotated !== 0) {
    throw new Error(`Closed dialog body should not be annotated, got ${closedDialogAnnotated}`);
  }
  await page.locator('#dialog-panel').evaluate((dialog) => {
    (dialog as HTMLDialogElement).open = true;
  });
  await page.locator('#dialog-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const collapsedAccordionAnnotated = await page.locator('#accordion-panel [data-qianci-word]').count();
  if (collapsedAccordionAnnotated !== 0) {
    throw new Error(`Collapsed ARIA panel should not be annotated, got ${collapsedAccordionAnnotated}`);
  }
  await page.locator('#accordion-toggle').evaluate((button) => {
    button.setAttribute('aria-expanded', 'true');
  });
  await page.locator('#accordion-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });

  const collapsedBootstrapAnnotated = await page.locator('#bootstrap-panel [data-qianci-word]').count();
  if (collapsedBootstrapAnnotated !== 0) {
    throw new Error(`Collapsed Bootstrap panel should not be annotated, got ${collapsedBootstrapAnnotated}`);
  }
  await page.locator('#bootstrap-panel').evaluate((panel) => {
    panel.classList.add('show');
  });
  await page.locator('#bootstrap-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const hiddenDropdownAnnotated = await page.locator('#dropdown-menu [data-qianci-word]').count();
  if (hiddenDropdownAnnotated !== 0) {
    throw new Error(`Hidden Bootstrap dropdown should not be annotated, got ${hiddenDropdownAnnotated}`);
  }
  await page.locator('#dropdown-menu').evaluate((menu) => {
    menu.classList.add('show');
  });
  await page.locator('#dropdown-menu [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#dropdown-menu').evaluate((menu) => {
    menu.classList.remove('show');
  });
  await page.waitForFunction(() => document.querySelector('#dropdown-menu [data-qianci-word]') === null);
  const nativePopoverAnnotated = await page.locator('#native-popover [data-qianci-word]').count();
  const statefulPopoverAnnotated = await page.locator('#stateful-popover [data-qianci-word]').count();
  if (nativePopoverAnnotated !== 0 || statefulPopoverAnnotated !== 0) {
    throw new Error(
      `Closed popover content should not start annotated: ${nativePopoverAnnotated}/${statefulPopoverAnnotated}`
    );
  }
  await page.locator('#native-popover').evaluate((popover) => {
    const nativePopover = popover as HTMLElement & { showPopover?: () => void };
    nativePopover.showPopover?.();
  });
  await page.locator('#native-popover [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#stateful-popover').evaluate((popover) => {
    popover.setAttribute('data-state', 'open');
  });
  await page.locator('#stateful-popover [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#stateful-popover').evaluate((popover) => {
    popover.setAttribute('data-state', 'closed');
  });
  await page.waitForFunction(() => document.querySelector('#stateful-popover [data-qianci-word]') === null);
  const closedHeadlessCounts = [
    await page.locator('#headless-panel [data-qianci-word]').count(),
    await page.locator('#legacy-headless-panel [data-qianci-word]').count()
  ];
  if (closedHeadlessCounts.some((count) => count !== 0)) {
    throw new Error(`Closed Headless UI panels should not be annotated: ${closedHeadlessCounts.join('/')}`);
  }
  await page.locator('#headless-panel').evaluate((panel) => {
    panel.removeAttribute('data-closed');
    panel.removeAttribute('data-leave');
  });
  await page.locator('#legacy-headless-panel').evaluate((panel) => {
    panel.setAttribute('data-headlessui-state', 'open');
  });
  await page.locator('#headless-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#legacy-headless-panel [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  const pageTooltipCounts = [
    await page.locator('#native-tooltip [data-qianci-word]').count(),
    await page.locator('#floating-portal [data-qianci-word]').count(),
    await page.locator('#radix-popper [data-qianci-word]').count()
  ];
  if (pageTooltipCounts.some((count) => count !== 0)) {
    throw new Error(`Page-owned tooltip and popper content should not be annotated: ${pageTooltipCounts.join('/')}`);
  }
  await page.locator('#active-tab-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const inactiveTabAnnotated = await page.locator('#inactive-tab-panel [data-qianci-word]').count();
  if (inactiveTabAnnotated !== 0) {
    throw new Error(`Inactive ARIA tab panel should not be annotated, got ${inactiveTabAnnotated}`);
  }
  await page.locator('#active-tab-button').evaluate((button) => {
    button.setAttribute('aria-selected', 'false');
  });
  await page.locator('#inactive-tab-button').evaluate((button) => {
    button.setAttribute('aria-selected', 'true');
  });
  await page.waitForFunction(() => document.querySelector('#active-tab-panel [data-qianci-word]') === null);
  await page.locator('#inactive-tab-panel [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#bootstrap-active-tab [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const inactiveBootstrapTabAnnotated = await page.locator('#bootstrap-inactive-tab [data-qianci-word]').count();
  if (inactiveBootstrapTabAnnotated !== 0) {
    throw new Error(`Inactive Bootstrap tab pane should not be annotated, got ${inactiveBootstrapTabAnnotated}`);
  }
  await page.locator('#bootstrap-inactive-tab').evaluate((panel) => {
    panel.classList.add('active', 'show');
  });
  await page.locator('#bootstrap-inactive-tab [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });
  const fadeBootstrapTabAnnotated = await page.locator('#bootstrap-fade-tab [data-qianci-word]').count();
  if (fadeBootstrapTabAnnotated !== 0) {
    throw new Error(`Bootstrap fade active tab should wait for show class, got ${fadeBootstrapTabAnnotated}`);
  }
  await page.locator('#bootstrap-fade-tab').evaluate((panel) => {
    panel.classList.add('show');
  });
  await page.locator('#bootstrap-fade-tab [data-qianci-word="meticulous"]').waitFor({ state: 'visible', timeout: 10_000 });

  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#shadow-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('[data-qianci-word="meticulous"]').length === 1;
  });
  await page.locator('#slot-host [slot="body"] [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  const slotFallbackAnnotated = await page.evaluate(() => {
    const shadowRoot = document.querySelector('#slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('slot [data-qianci-word]').length ?? 0;
  });
  if (slotFallbackAnnotated !== 0) {
    throw new Error(`Assigned slot fallback should not be annotated, got ${slotFallbackAnnotated}`);
  }
  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#fallback-slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('slot [data-qianci-word="meticulous"]').length === 1;
  });
  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#dynamic-slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('slot [data-qianci-word="meticulous"]').length === 1;
  });
  await page.locator('#dynamic-slot-host').evaluate((host) => {
    const assignedParagraph = document.createElement('p');
    assignedParagraph.slot = 'body';
    assignedParagraph.textContent = 'The meticulous dynamic assigned body is visible.';
    host.append(assignedParagraph);
  });
  await page.locator('#dynamic-slot-host > [slot="body"] [data-qianci-word="meticulous"]').waitFor({
    state: 'visible',
    timeout: 10_000
  });
  const dynamicSlotFallbackAnnotated = await page.evaluate(() => {
    const shadowRoot = document.querySelector('#dynamic-slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('slot [data-qianci-word]').length ?? 0;
  });
  if (dynamicSlotFallbackAnnotated !== 0) {
    throw new Error(`Dynamic assigned slot fallback should not be annotated, got ${dynamicSlotFallbackAnnotated}`);
  }
  await page.locator('#dynamic-slot-host > [slot="body"]').evaluate((assignedNode) => {
    assignedNode.remove();
  });
  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#dynamic-slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('slot [data-qianci-word="meticulous"]').length === 1;
  });
  await page.waitForFunction(() => {
    const shadowRoot = document.querySelector('#no-slot-host')?.shadowRoot;
    return shadowRoot?.querySelectorAll('[data-qianci-word="meticulous"]').length === 1;
  });
  const noSlotLightDomAnnotated = await page.evaluate(() => {
    return document.querySelector('#no-slot-host')?.querySelectorAll('[data-qianci-word]').length ?? 0;
  });
  if (noSlotLightDomAnnotated !== 0) {
    throw new Error(`Unassigned light DOM should not be annotated, got ${noSlotLightDomAnnotated}`);
  }
  const iframeAnnotated = await page.locator('#embedded-copy').evaluate((iframe) => {
    const frame = iframe as HTMLIFrameElement;
    return frame.contentDocument?.querySelectorAll('[data-qianci-word]').length ?? 0;
  });
  if (iframeAnnotated !== 0) {
    throw new Error(`Default iframe content should not be annotated, got ${iframeAnnotated}`);
  }

  const virtualScrollWord = page.locator('#virtualized-recycled-row [data-qianci-word="unobtrusive"]');
  await virtualScrollWord.waitFor({ state: 'visible', timeout: 10_000 });
  const virtualScrollTop = await page.locator('#virtual-scroll').evaluate((container) => container.scrollTop);
  if (virtualScrollTop !== 320) {
    throw new Error(`Virtual scroll position should stay stable after annotation, got ${virtualScrollTop}`);
  }
  await page.locator('#virtualized-recycled-row').evaluate((row) => {
    row.textContent = 'The meticulous recycled row was reused without scroll drift.';
  });
  await page.waitForFunction(() => {
    const container = document.querySelector('#virtual-scroll');
    const row = document.querySelector('#virtualized-recycled-row');
    if (!(container instanceof HTMLElement) || !row) {
      return false;
    }
    return (
      container.scrollTop === 320 &&
      row.querySelector('[data-qianci-word="meticulous"]') &&
      !row.querySelector('[data-qianci-word="unobtrusive"]')
    );
  });
  const absoluteVirtualWord = page.locator('#absolute-virtual-row [data-qianci-word="meticulous"]');
  await absoluteVirtualWord.waitFor({ state: 'visible', timeout: 10_000 });
  const absoluteMeasureCount = await page.locator('#absolute-virtual-measure [data-qianci-word]').count();
  if (absoluteMeasureCount !== 0) {
    throw new Error(`Absolute virtual measuring row should not be annotated, got ${absoluteMeasureCount}`);
  }
  await page.locator('#absolute-virtual-list').evaluate((container) => {
    container.scrollTop = 1920;
    const row = document.querySelector('#absolute-virtual-row');
    if (!(row instanceof HTMLElement)) {
      throw new Error('Missing absolute virtual row');
    }
    row.style.transform = 'translateY(1920px)';
    row.textContent = 'The ubiquitous absolute virtual row was recycled.';
  });
  await page.waitForFunction(() => {
    const container = document.querySelector('#absolute-virtual-list');
    const row = document.querySelector('#absolute-virtual-row');
    if (!(container instanceof HTMLElement) || !row) {
      return false;
    }
    return (
      container.scrollTop === 1920 &&
      row.querySelectorAll('[data-qianci-word="ubiquitous"]').length === 1 &&
      row.querySelectorAll('[data-qianci-word="meticulous"]').length === 0 &&
      !row.querySelector('[data-qianci-word] [data-qianci-word]')
    );
  });

  const virtualRowAnnotated = page.locator('#virtual-row [data-qianci-word="unobtrusive"]');
  await virtualRowAnnotated.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#virtual-row').evaluate((row) => {
    row.textContent = 'The meticulous virtual row was reused.';
  });
  await page.waitForFunction(() => {
    const row = document.querySelector('#virtual-row');
    if (!row) {
      return false;
    }
    return row.querySelector('[data-qianci-word="meticulous"]') && !row.querySelector('[data-qianci-word="unobtrusive"]');
  });
  const spaFirstRouteWord = page.locator('#spa-root [data-qianci-word="unobtrusive"]');
  await spaFirstRouteWord.waitFor({ state: 'visible', timeout: 10_000 });
  await spaFirstRouteWord.click({ timeout: 10_000 });
  await page.locator('[data-qianci-tooltip]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#spa-root').evaluate((root) => {
    history.pushState({}, '', '/smoke-second-route');
    root.innerHTML = '<p>The meticulous smoke route is readable now.</p>';
    history.replaceState({}, '', '/smoke-third-route');
    root.innerHTML = '<p>The ubiquitous smoke route is readable now.</p>';
  });
  await page.waitForFunction(() => {
    const root = document.querySelector('#spa-root');
    const tooltip = document.querySelector('[data-qianci-tooltip]');
    if (!root || !(tooltip instanceof HTMLElement)) {
      return false;
    }

    return (
      tooltip.style.display === 'none' &&
      root.querySelectorAll('[data-qianci-word="ubiquitous"]').length === 1 &&
      root.querySelectorAll('[data-qianci-word="unobtrusive"]').length === 0 &&
      root.querySelectorAll('[data-qianci-word="meticulous"]').length === 0
    );
  });
  await page.evaluate((url) => {
    history.replaceState({}, '', url);
  }, compatUrl);
  const disappearingWord = page.locator('#disappearing-row [data-qianci-word="ubiquitous"]');
  await disappearingWord.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#disappearing-row').evaluate((row) => {
    row.addEventListener(
      'click',
      () => {
        row.remove();
      },
      { capture: true, once: true }
    );
  });
  await disappearingWord.click({ timeout: 10_000 });
  await page.waitForTimeout(100);
  const orphanTooltipText = await page.evaluate(() => {
    const element = document.querySelector('[data-qianci-tooltip]');
    if (!(element instanceof HTMLElement) || element.style.display === 'none') {
      return '';
    }
    return element.shadowRoot?.textContent ?? element.textContent ?? '';
  });
  if (orphanTooltipText.includes('无处不在') || orphanTooltipText.includes('ubiquitous')) {
    throw new Error(`Removed lookup anchor should not leave an orphan tooltip: ${orphanTooltipText}`);
  }

  const selectionClickWasNotCancelled = await page.evaluate(() => {
    const selectedWord = document.querySelector('[data-qianci-word="meticulous"]');
    if (!selectedWord) {
      throw new Error('Missing article word for selection compatibility check');
    }

    const range = document.createRange();
    range.selectNodeContents(selectedWord);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selectedWord.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  if (!selectionClickWasNotCancelled) {
    throw new Error('Active text selection click should not be cancelled by QianCi');
  }

  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  const linkWord = page.locator('a [data-qianci-word="unobtrusive"]');
  await linkWord.waitFor({ state: 'visible', timeout: 10_000 });
  await linkWord.click({ timeout: 10_000 });

  const tooltip = page.locator('[data-qianci-tooltip]');
  await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
  const tooltipText = await tooltip.evaluate((element) => element.shadowRoot?.textContent ?? element.textContent ?? '');
  const result = {
    stayedOnPage: page.url() === compatUrl,
    anchorClicks: await page.evaluate(() => (window as unknown as { anchorClicks: number }).anchorClicks),
    linkAnnotated: await page.locator('a [data-qianci-word="unobtrusive"]').count(),
    articleAnnotated: await page.locator('#main-article-paragraph [data-qianci-word="meticulous"]').count(),
    roleButtonAnnotated: await page.locator('[role="button"] [data-qianci-word]').count(),
    roleMenuitemAnnotated: await page.locator('[role="menuitem"] [data-qianci-word]').count(),
    summaryAnnotated: await page.locator('summary [data-qianci-word]').count(),
    labelAnnotated: await page.locator('label [data-qianci-word]').count(),
    ignoreClassAnnotated: await page.locator('.qianci-ignore [data-qianci-word]').count(),
    ignoreDataAnnotated: await page.locator('[data-qianci-ignore] [data-qianci-word]').count(),
    roleTextboxAnnotated: await page.locator('[role="textbox"] [data-qianci-word]').count(),
    contenteditableAnnotated: await page.locator('[contenteditable] [data-qianci-word]').count(),
    hiddenAnnotated: await page.locator('[hidden] [data-qianci-word]').count(),
    ariaHiddenAnnotated: await page.locator('[aria-hidden="true"] [data-qianci-word]').count(),
    svgAnnotated: await page.locator('svg [data-qianci-word]').count(),
    tooltipHasTranslation: tooltipText.includes('不唐突的') || tooltipText.includes('不显眼')
  };

  const skippedAnnotationCounts = [
    result.roleButtonAnnotated,
    result.roleMenuitemAnnotated,
    result.summaryAnnotated,
    result.labelAnnotated,
    result.ignoreClassAnnotated,
    result.ignoreDataAnnotated,
    result.roleTextboxAnnotated,
    result.contenteditableAnnotated,
    result.hiddenAnnotated,
    result.ariaHiddenAnnotated,
    result.svgAnnotated
  ];
  if (
    !result.stayedOnPage ||
    result.anchorClicks !== 0 ||
    result.linkAnnotated !== 1 ||
    result.articleAnnotated !== 1 ||
    skippedAnnotationCounts.some((count) => count !== 0) ||
    !result.tooltipHasTranslation
  ) {
    throw new Error(`Compatibility smoke failed: ${JSON.stringify(result)}`);
  }
}

async function main(): Promise<void> {
  const distDir = resolve(process.cwd(), 'dist');
  const manifestText = await readFile(resolve(distDir, 'manifest.json'), 'utf8');
  if (!manifestText.includes('潜词')) {
    throw new Error('Built manifest is missing the extension name');
  }
  const manifest = JSON.parse(manifestText) as BuiltManifest;
  assertTopFrameOnlyManifest(manifest);
  const contentBundle = findContentBundle(manifest);
  const rankIndexResource = findRankIndexResource(manifest);
  await assertContentBundleBudget(distDir, contentBundle);
  await assertInitialContentAssetBudget(distDir, contentBundle, rankIndexResource);
  const serviceWorkerBundle = await findServiceWorkerBundle();
  const serviceWorkerText = await readFile(resolve(distDir, serviceWorkerBundle), 'utf8');
  const hasActionClickHandler =
    serviceWorkerText.includes('chrome.action.onClicked') ||
    serviceWorkerText.includes('.action.onClicked') ||
    serviceWorkerText.includes('onClicked.addListener');
  if (!hasActionClickHandler || !serviceWorkerText.includes('openOptionsPage')) {
    throw new Error('Built service worker does not register the options-page click handler');
  }

  const { url, compatUrl, close } = await startServer(distDir, contentBundle);

  console.log(`Smoke page: ${url}`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const page = await browser.newPage();
    console.log('Navigating...');
    await assertBaselineLookup(page, url);
    await assertCompatibilityLookup(page, compatUrl);

    console.log('Smoke test passed.');
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
