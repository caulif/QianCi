import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

interface BuiltManifest {
  web_accessible_resources?: Array<{ resources?: string[] }>;
}

interface SmokeServer {
  url: string;
  compatUrl: string;
  close: () => Promise<void>;
}

const MAX_CONTENT_BUNDLE_BYTES = 650 * 1024;
const MAX_INITIAL_CONTENT_ASSET_BYTES = 2 * 1024 * 1024;

const CLICK_PROFILE_SCRIPT = JSON.stringify({
  level: 'starter',
  levelScore: 1.8,
  underlineTone: 'graphite',
  lookupTrigger: 'click',
  manualShortcut: 'alt',
  annotationDensity: 1,
  feedbackSettings: {
    skipLimit: 3,
    skipDelayMs: 3500,
    decayHalfLifeDays: 30,
    suppressionMode: 'balanced'
  },
  words: {}
});

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

/**
 * Creates a browser-compatible Chrome API stub for smoke pages.
 *
 * @param initialStore JavaScript object literal assigned to the in-memory storage.
 * @returns Inline script that provides the subset of Chrome APIs used by the content bundle.
 */
function chromeApiStubScript(initialStore = '{}'): string {
  return `<script>
      const store = ${initialStore};
      const messageListeners = [];
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(listener) {
              messageListeners.push(listener);
            }
          },
          sendMessage() {
            return Promise.resolve({ ok: false, message: 'not used in smoke test' });
          }
        },
        storage: {
          onChanged: {
            addListener() {}
          },
          local: {
            get(keys, callback) {
              const result = {};
              for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
              }
              callback(result);
            },
            set(values, callback) {
              Object.assign(store, values);
              callback && callback();
            },
            remove(keys, callback) {
              for (const key of keys) delete store[key];
              callback && callback();
            },
            clear(callback) {
              for (const key of Object.keys(store)) delete store[key];
              callback && callback();
            }
          }
        }
      };
    </script>`;
}

/**
 * Renders the default smoke page that validates baseline hover lookup.
 *
 * @param contentBundle Built content-script asset path.
 * @returns HTML page served by the local smoke server.
 */
function defaultSmokeHtml(contentBundle: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>QianCi Smoke</title></head>
  <body>
    ${chromeApiStubScript()}
    <article>
      <p>The unobtrusive tool was meticulous and ubiquitous.</p>
    </article>
    <script type="module" src="/${contentBundle}"></script>
  </body>
</html>`;
}

/**
 * Renders a compatibility smoke page with links and interactive regions.
 *
 * @param contentBundle Built content-script asset path.
 * @returns HTML page served by the local smoke server.
 */
function compatibilitySmokeHtml(contentBundle: string): string {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>QianCi Compatibility Smoke</title></head>
  <body>
    <script>window.anchorClicks = 0;</script>
    ${chromeApiStubScript(`{ 'qianci.profile': ${CLICK_PROFILE_SCRIPT} }`)}
    <article>
      <a id="nav" href="/next" onclick="window.anchorClicks += 1">Read the unobtrusive guide</a>
      <p>The meticulous article remains readable.</p>
      <section class="qianci-ignore">The meticulous sidebar should stay untouched.</section>
      <aside data-qianci-ignore="true">The meticulous widget should stay untouched.</aside>
      <section id="dynamic-ignore">The meticulous promo starts as readable.</section>
      <section id="style-hidden" style="display: none">The meticulous hidden style panel is collapsed.</section>
      <section id="style-restore" style="display: none">The meticulous restored style panel appears later.</section>
      <section id="class-hidden" class="d-none">The meticulous class hidden panel appears later.</section>
      <details id="details-panel">
        <summary>Open meticulous details</summary>
        <p>The meticulous details body appears later.</p>
      </details>
      <dialog id="dialog-panel">
        <p>The meticulous dialog body appears later.</p>
      </dialog>
      <button id="accordion-toggle" aria-expanded="false" aria-controls="accordion-panel">Toggle accordion</button>
      <section id="accordion-panel">
        <p>The meticulous accordion body appears later.</p>
      </section>
      <section id="bootstrap-panel" class="collapse">
        <p>The meticulous bootstrap body appears later.</p>
      </section>
      <div role="tablist">
        <button id="active-tab-button" role="tab" aria-selected="true" aria-controls="active-tab-panel">Active tab</button>
        <button id="inactive-tab-button" role="tab" aria-selected="false" aria-controls="inactive-tab-panel">Inactive tab</button>
      </div>
      <section id="active-tab-panel" role="tabpanel">
        <p>The meticulous active tab body is readable.</p>
      </section>
      <section id="inactive-tab-panel" role="tabpanel">
        <p>The meticulous inactive tab body appears later.</p>
      </section>
      <section id="bootstrap-inactive-tab" class="tab-pane">
        <p>The meticulous inactive bootstrap tab appears later.</p>
      </section>
      <section id="bootstrap-active-tab" class="tab-pane active show">
        <p>The meticulous active bootstrap tab is readable.</p>
      </section>
      <section id="bootstrap-fade-tab" class="tab-pane fade active">
        <p>The meticulous fade bootstrap tab appears after transition.</p>
      </section>
      <qianci-shadow-reader id="shadow-host"></qianci-shadow-reader>
      <iframe id="embedded-copy" srcdoc="<p>The meticulous iframe copy is isolated.</p>"></iframe>
      <div id="virtual-row"><p>The unobtrusive virtual row is visible.</p></div>
      <p id="disappearing-row">The ubiquitous disappearing row may unload.</p>
      <div role="button">Open the meticulous menu</div>
      <div role="menuitem">Choose the meticulous action</div>
      <summary>The meticulous details title</summary>
      <label>The meticulous form label</label>
      <div role="textbox">The meticulous draft is editable.</div>
      <div contenteditable>The meticulous draft is editable.</div>
      <p hidden>The meticulous hidden copy is invisible.</p>
      <p aria-hidden="true">The meticulous decoration is invisible.</p>
      <svg><text>The meticulous svg label is graphical.</text></svg>
    </article>
    <script>
      const shadowHost = document.querySelector('#shadow-host');
      shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<p>The meticulous shadow text appears.</p>';
    </script>
    <script type="module" src="/${contentBundle}"></script>
  </body>
</html>`;
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

  const articleWord = page.locator('article > p:not([hidden]):not([aria-hidden]) [data-qianci-word="meticulous"]');
  await articleWord.waitFor({ state: 'visible', timeout: 10_000 });
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
  const iframeAnnotated = await page.locator('#embedded-copy').evaluate((iframe) => {
    const frame = iframe as HTMLIFrameElement;
    return frame.contentDocument?.querySelectorAll('[data-qianci-word]').length ?? 0;
  });
  if (iframeAnnotated !== 0) {
    throw new Error(`Default iframe content should not be annotated, got ${iframeAnnotated}`);
  }

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
  const disappearingWord = page.locator('#disappearing-row [data-qianci-word="ubiquitous"]');
  await disappearingWord.waitFor({ state: 'visible', timeout: 10_000 });
  await disappearingWord.click({ timeout: 10_000 });
  await page.locator('#disappearing-row').evaluate((row) => {
    row.remove();
  });
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
    articleAnnotated: await page.locator('article > p:not([hidden]):not([aria-hidden]) [data-qianci-word="meticulous"]').count(),
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
