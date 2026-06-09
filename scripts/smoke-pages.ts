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
export function defaultSmokeHtml(contentBundle: string): string {
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
export function compatibilitySmokeHtml(contentBundle: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>QianCi Compatibility Smoke</title>
    <style>
      body { margin: 0; padding-top: 80px; }
      .css-invisible { visibility: hidden; }
      .css-transparent { opacity: 0; }
      .css-content-hidden { content-visibility: hidden; }
      [data-selector-hidden] { display: none; }
      .measurement-row { height: 0; overflow: hidden; }
      .scale-hidden { transform: scale(0); }
      .zero-box-hidden { width: 0; height: 0; overflow: hidden; }
      .fixed-smoke-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 72px;
        z-index: 1000000;
        background: white;
      }
      .fixed-smoke-footer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: 96px;
        z-index: 1000000;
        background: white;
      }
      .near-fixed-header-word { margin-top: 84px; }
      .near-fixed-footer-word {
        position: fixed;
        left: 96px;
        bottom: 104px;
        z-index: 999999;
        background: white;
      }
      .virtual-scroll {
        height: 96px;
        overflow: auto;
        border: 1px solid #ddd;
      }
      .virtual-scroll-row {
        height: 32px;
        line-height: 32px;
      }
      .css-offscreen { position: absolute; left: -9999px; }
      .css-clipped {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }
    </style>
  </head>
  <body>
    <script>window.anchorClicks = 0;</script>
    ${chromeApiStubScript(`{ 'qianci.profile': ${CLICK_PROFILE_SCRIPT} }`)}
    <header id="fixed-smoke-header" class="fixed-smoke-header">Fixed smoke header</header>
    <footer id="fixed-smoke-footer" class="fixed-smoke-footer">Fixed smoke footer</footer>
    <nav id="site-nav">The meticulous site navigation should stay untouched.</nav>
    <div id="breadcrumb" role="navigation">The meticulous breadcrumb should stay untouched.</div>
    <article>
      <header id="article-meta" class="article-meta">
        <p class="byline">The meticulous author metadata should stay untouched.</p>
        <time datetime="2026-06-09">The meticulous publication metadata should stay untouched.</time>
      </header>
      <nav id="article-toc" class="toc">The meticulous article toc should stay untouched.</nav>
      <a id="nav" href="/next" onclick="window.anchorClicks += 1">Read the unobtrusive guide</a>
      <p class="near-fixed-header-word">The meticulous header-adjacent word remains readable.</p>
      <p class="near-fixed-footer-word">The meticulous footer-adjacent word remains readable.</p>
      <p id="main-article-paragraph">The meticulous article remains readable.</p>
      <pre id="code-sample"><code>The meticulous code sample should stay untouched.</code></pre>
      <div id="monaco-surface" class="monaco-editor">The meticulous monaco surface should stay untouched.</div>
      <div id="codemirror-surface" class="cm-editor">The meticulous codemirror surface should stay untouched.</div>
      <table id="github-diff-sample" class="diff-table">
        <tbody>
          <tr>
            <td class="blob-num">The meticulous line gutter should stay untouched.</td>
            <td class="blob-code"><span class="blob-code-inner">The meticulous diff code should stay untouched.</span></td>
          </tr>
          <tr>
            <td class="diff-line-num">The meticulous unified gutter should stay untouched.</td>
            <td class="diff-line-code">The meticulous unified diff should stay untouched.</td>
          </tr>
        </tbody>
      </table>
      <div id="github-code-view" class="react-code-lines">
        <div class="react-code-text">The meticulous virtual code should stay untouched.</div>
        <div class="js-file-line">The meticulous file line should stay untouched.</div>
      </div>
      <section id="github-lazy-files"></section>
      <aside id="share-bar" class="share-bar">The meticulous share copy should stay untouched.</aside>
      <section id="ad-slot" class="advertisement">The meticulous ad copy should stay untouched.</section>
      <section id="related-posts" class="related-posts">The meticulous related copy should stay untouched.</section>
      <section id="mdn-layout-sample">
        <aside class="left-sidebar">The meticulous MDN left sidebar should stay untouched.</aside>
        <nav class="breadcrumbs">The meticulous MDN breadcrumb should stay untouched.</nav>
        <aside class="reference-toc">The meticulous MDN toc should stay untouched.</aside>
        <aside class="layout__right-sidebar">The meticulous MDN right sidebar should stay untouched.</aside>
        <section class="metadata">The meticulous MDN metadata should stay untouched.</section>
        <table class="bc-table"><tbody><tr><td>The meticulous compat table should stay untouched.</td></tr></tbody></table>
        <footer class="article-footer">The meticulous MDN footer should stay untouched.</footer>
      </section>
      <section id="pdfjs-sample">
        <p>The meticulous PDF-adjacent summary remains readable.</p>
        <div class="pdfViewer">
          <div class="page" data-page-number="1">
            <div class="textLayer">
              <span>The meticulous PDF text layer should stay untouched.</span>
            </div>
            <section class="annotationLayer">
              <a href="#pdf-link">The meticulous PDF link annotation should stay untouched.</a>
            </section>
            <section class="xfaLayer">
              <div>The meticulous PDF form layer should stay untouched.</div>
            </section>
          </div>
          <div id="lazy-pdf-page"></div>
        </div>
      </section>
      <section id="academic-paper-sample">
        <header class="ltx_authors">The meticulous author metadata should stay untouched.</header>
        <section class="abstract">
          <p>The meticulous academic abstract remains readable.</p>
        </section>
        <p>The meticulous academic body remains readable.</p>
        <a class="ltx_ref" href="#academic-bib">The meticulous citation link should stay untouched.</a>
        <span class="citation">The meticulous inline citation should stay untouched.</span>
        <span class="ltx_tag ltx_tag_equation">The meticulous equation number should stay untouched.</span>
        <aside role="doc-footnote">The meticulous academic footnote should stay untouched.</aside>
        <section class="footnotes">The meticulous academic footnote list should stay untouched.</section>
        <section role="doc-bibliography" class="bibliography">
          <p id="academic-bib">The meticulous academic bibliography should stay untouched.</p>
        </section>
        <span id="academic-citation-popups"></span>
      </section>
      <section id="search-results-sample">
        <form role="search" class="search__form">
          <label>The meticulous search label should stay untouched.</label>
          <input class="search__input" value="meticulous query">
        </form>
        <article class="result">
          <a class="result__title" href="/search-target">The meticulous search title remains readable.</a>
          <cite class="result__url">https://example.com/meticulous</cite>
          <p class="result__snippet">The meticulous search snippet remains readable.</p>
          <div class="result__extras">The meticulous search extras should stay untouched.</div>
          <div class="result__sitelinks">The meticulous sitelink should stay untouched.</div>
        </article>
        <article class="result result--ad">The meticulous sponsored result should stay untouched.</article>
        <section class="people-also-ask">The meticulous people also ask should stay untouched.</section>
        <aside class="related-searches">The meticulous related search should stay untouched.</aside>
        <nav class="pagination">The meticulous pagination should stay untouched.</nav>
      </section>
      <section id="commerce-product" class="product">
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
      </section>
      <section id="overlay-noise-sample">
        <section id="onetrust-banner-sdk">
          <div class="ot-sdk-container">The meticulous OneTrust banner should stay untouched.</div>
        </section>
        <section id="CybotCookiebotDialog">
          <p class="CookieDeclarationDialogText">The meticulous Cookiebot dialog should stay untouched.</p>
        </section>
        <aside class="newsletter-popup">The meticulous newsletter popup should stay untouched.</aside>
        <aside class="announcement-bar">The meticulous announcement bar should stay untouched.</aside>
        <section id="cookie-research">
          <p>The meticulous article about browser cookies remains readable.</p>
        </section>
        <div id="late-overlay-root"></div>
      </section>
      <section class="qianci-ignore">The meticulous sidebar should stay untouched.</section>
      <aside data-qianci-ignore="true">The meticulous widget should stay untouched.</aside>
      <section id="polite-live" aria-live="polite">The meticulous live update should stay untouched.</section>
      <section id="status-toast" role="status">The meticulous status toast should stay untouched.</section>
      <section id="alert-toast" role="alert">The meticulous alert toast should stay untouched.</section>
      <section id="translate-no" translate="no">The meticulous product name should stay untouched.</section>
      <section id="notranslate" class="notranslate">The meticulous machine label should stay untouched.</section>
      <span id="katex-renderer" class="katex">The meticulous formula renderer should stay untouched.</span>
      <mjx-container id="mathjax-renderer">The meticulous MathJax renderer should stay untouched.</mjx-container>
      <ruby id="ruby-copy">漢<rt>The meticulous ruby annotation should stay untouched.</rt></ruby>
      <section id="busy-panel" aria-busy="true">The meticulous loading copy appears later.</section>
      <div id="toolbar-widget" role="toolbar">The meticulous toolbar command should stay untouched.</div>
      <div id="grid-widget" role="grid">The meticulous data grid cell should stay untouched.</div>
      <button id="named-action" aria-labelledby="named-action-label"></button>
      <span id="named-action-label">The meticulous command name should stay untouched.</span>
      <input id="described-input" aria-describedby="described-input-hint">
      <p id="described-input-hint">The meticulous input hint should stay untouched.</p>
      <div id="onclick-card" onclick="window.cardClicked = true">The meticulous clickable card should stay untouched.</div>
      <div id="tabindex-card" tabindex="0">The meticulous focusable card should stay untouched.</div>
      <div id="menu-trigger" aria-haspopup="menu">The meticulous menu trigger should stay untouched.</div>
      <span id="action-chip" data-action="open-menu">The meticulous action chip should stay untouched.</span>
      <section id="dynamic-ignore">The meticulous promo starts as readable.</section>
      <section id="style-hidden" style="display: none">The meticulous hidden style panel is collapsed.</section>
      <section id="style-restore" style="display: none">The meticulous restored style panel appears later.</section>
      <section id="class-hidden" class="d-none">The meticulous class hidden panel appears later.</section>
      <span id="bootstrap-a11y" class="visually-hidden">The meticulous bootstrap a11y label is assistive only.</span>
      <span id="tailwind-a11y" class="sr-only">The meticulous tailwind a11y label is assistive only.</span>
      <section id="css-invisible" class="css-invisible">The meticulous css invisible panel appears later.</section>
      <section id="css-transparent" class="css-transparent">The meticulous css transparent panel appears later.</section>
      <section id="css-content-hidden" class="css-content-hidden">The meticulous css content hidden panel appears later.</section>
      <section id="css-selector-hidden" data-selector-hidden>The meticulous selector hidden panel appears later.</section>
      <section id="measurement-row" class="measurement-row">The meticulous measurement row appears later.</section>
      <section id="scale-hidden-panel" class="scale-hidden">The meticulous transform hidden panel appears later.</section>
      <section id="zero-box-panel" class="zero-box-hidden">The meticulous zero box panel appears later.</section>
      <section id="css-offscreen" class="css-offscreen">The meticulous css offscreen panel appears later.</section>
      <section id="css-clipped" class="css-clipped">The meticulous css clipped panel appears later.</section>
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
      <section id="dropdown-menu" class="dropdown-menu">
        <p>The meticulous dropdown item appears later.</p>
      </section>
      <section id="native-popover" popover>
        <p>The meticulous native popover body appears later.</p>
      </section>
      <section id="stateful-popover" role="dialog" data-state="closed" data-side="bottom">
        <p>The meticulous stateful popover body appears later.</p>
      </section>
      <section id="headless-panel" data-closed data-leave>
        <p>The meticulous headless disclosure body appears later.</p>
      </section>
      <section id="legacy-headless-panel" data-headlessui-state="closed">
        <p>The meticulous legacy headless body appears later.</p>
      </section>
      <div id="native-tooltip" role="tooltip">The meticulous page tooltip should stay untouched.</div>
      <div id="floating-portal" data-floating-ui-portal>
        <div role="tooltip">The meticulous floating tooltip should stay untouched.</div>
      </div>
      <div id="radix-popper" data-radix-popper-content-wrapper>
        <div data-side="top">The meticulous radix popper should stay untouched.</div>
      </div>
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
      <late-shadow-reader id="late-shadow-host"></late-shadow-reader>
      <slot-reader id="slot-host">
        <p slot="body">The meticulous assigned slot body is visible.</p>
      </slot-reader>
      <fallback-slot-reader id="fallback-slot-host"></fallback-slot-reader>
      <dynamic-slot-reader id="dynamic-slot-host"></dynamic-slot-reader>
      <no-slot-reader id="no-slot-host">
        <p>The meticulous unassigned light body is not rendered.</p>
      </no-slot-reader>
      <iframe id="embedded-copy" srcdoc="<p>The meticulous iframe copy is isolated.</p>"></iframe>
      <div id="virtual-scroll" class="virtual-scroll">
        <div class="virtual-scroll-row">The meticulous virtual row 0 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 1 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 2 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 3 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 4 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 5 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 6 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 7 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 8 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 9 remains readable.</div>
        <div id="virtualized-recycled-row" class="virtual-scroll-row">The unobtrusive recycled row is visible.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 11 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 12 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 13 remains readable.</div>
        <div class="virtual-scroll-row">The meticulous virtual row 14 remains readable.</div>
      </div>
      <section id="absolute-virtual-list" style="height: 120px; overflow: auto; position: relative;">
        <div style="height: 4000px; position: relative;">
          <div id="absolute-virtual-measure" style="height: 0; overflow: hidden;">
            The meticulous absolute measure should stay untouched.
          </div>
          <div
            id="absolute-virtual-row"
            style="position: absolute; top: 0; left: 0; transform: translateY(960px); height: 32px;"
          >
            The meticulous absolute virtual row is readable.
          </div>
        </div>
      </section>
      <div id="virtual-row"><p>The unobtrusive virtual row is visible.</p></div>
      <section id="spa-root"><p>The unobtrusive smoke route is readable.</p></section>
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
    <footer id="page-footer">The meticulous page footer should stay untouched.</footer>
    <div id="page-contentinfo" role="contentinfo">The meticulous content info should stay untouched.</div>
    <script>
      const shadowHost = document.querySelector('#shadow-host');
      shadowHost.attachShadow({ mode: 'open' }).innerHTML = '<p>The meticulous shadow text appears.</p>';
      const slotHost = document.querySelector('#slot-host');
      slotHost.attachShadow({ mode: 'open' }).innerHTML =
        '<section><slot name="body">The meticulous fallback slot body is hidden.</slot></section>';
      const fallbackSlotHost = document.querySelector('#fallback-slot-host');
      fallbackSlotHost.attachShadow({ mode: 'open' }).innerHTML =
        '<section><slot name="body">The meticulous fallback slot body is visible.</slot></section>';
      const dynamicSlotHost = document.querySelector('#dynamic-slot-host');
      dynamicSlotHost.attachShadow({ mode: 'open' }).innerHTML =
        '<section><slot name="body">The meticulous dynamic fallback body is visible.</slot></section>';
      const noSlotHost = document.querySelector('#no-slot-host');
      noSlotHost.attachShadow({ mode: 'open' }).innerHTML = '<p>The meticulous no-slot shadow body is visible.</p>';
      document.querySelector('#virtual-scroll').scrollTop = 320;
    </script>
    <script type="module" src="/${contentBundle}"></script>
  </body>
</html>`;
}
