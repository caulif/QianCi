import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

interface BuiltManifest {
  web_accessible_resources?: Array<{ resources?: string[] }>;
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

async function startServer(distDir: string, contentBundle: string): Promise<{ url: string; close: () => Promise<void> }> {
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>QianCi Smoke</title></head>
  <body>
    <script>
      const store = {};
      window.chrome = {
        storage: {
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
    </script>
    <article>
      <p>The unobtrusive tool was meticulous and ubiquitous.</p>
    </article>
    <script type="module" src="/${contentBundle}"></script>
  </body>
</html>`;

  const server = createServer(async (req, res) => {
    if ((req.url ?? '/') === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
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

  const { url, close } = await startServer(distDir, contentBundle);

  console.log(`Smoke page: ${url}`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const page = await browser.newPage();
    console.log('Navigating...');
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
