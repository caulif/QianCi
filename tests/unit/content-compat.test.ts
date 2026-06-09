import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content compatibility', () => {
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
   * Reads the currently rendered tooltip text from its shadow root.
   *
   * @returns User-visible tooltip text, or an empty string when hidden.
   */
  function tooltipText(): string {
    const host = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    return host?.shadowRoot?.textContent ?? host?.textContent ?? '';
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens click-triggered lookup inside links without allowing navigation handlers to run', async () => {
    document.body.innerHTML = '<article><a href="/next">Read the unobtrusive guide</a></article>';
    const onLookup = vi.fn();
    const onAnchorClick = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const anchor = document.querySelector('a') as HTMLAnchorElement;
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    anchor.addEventListener('click', onAnchorClick);
    const eventWasNotCancelled = target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(eventWasNotCancelled).toBe(false);
    expect(onAnchorClick).not.toHaveBeenCalled();
    expect(onLookup).toHaveBeenCalledWith(
      'unobtrusive',
      'click',
      expect.objectContaining({ lookupTrigger: 'click' }),
      expect.objectContaining({ translation: '不显眼的' })
    );
    expect(tooltipText()).toContain('不显眼的');
    app.dispose();
  });

  it('does not show a click lookup tooltip after the annotated element is removed before lookup resolves', async () => {
    document.body.innerHTML = '<article><p>The unobtrusive article may disappear.</p></article>';
    const onLookup = vi.fn();
    let resolveLookup: (entry: DictionaryEntry) => void = () => undefined;
    const delayedResolver = vi.fn(
      async () =>
        await new Promise<DictionaryEntry>((resolvePromise) => {
          resolveLookup = resolvePromise;
        })
    );

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: delayedResolver,
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    target.remove();
    resolveLookup({ word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 });
    await Promise.resolve();
    await Promise.resolve();

    expect(onLookup).not.toHaveBeenCalled();
    expect(tooltipText()).toBe('');
    app.dispose();
  });

  it('does not annotate editable, hidden, or non-html text surfaces', async () => {
    document.body.innerHTML = `
      <article>
        <p>The unobtrusive article remains readable.</p>
        <div role="textbox">The meticulous draft is editable.</div>
        <div contenteditable>The meticulous draft is editable.</div>
        <p hidden>The meticulous hidden copy is invisible.</p>
        <p aria-hidden="true">The meticulous decoration is invisible.</p>
        <svg><text>The meticulous svg label is graphical.</text></svg>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('p:not([hidden]):not([aria-hidden]) [data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect(document.querySelector('[role="textbox"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[contenteditable] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[hidden] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[aria-hidden="true"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('svg [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('does not annotate custom interactive controls that should keep native page behavior', async () => {
    document.body.innerHTML = `
      <article>
        <p>The unobtrusive article remains readable.</p>
        <div role="button">Open the meticulous menu</div>
        <div role="menuitem">Choose the meticulous action</div>
        <summary>The meticulous details title</summary>
        <label>The meticulous form label</label>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('p [data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect(document.querySelector('[role="button"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[role="menuitem"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('summary [data-qianci-word]')).toBeNull();
    expect(document.querySelector('label [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('does not treat a click on an annotated word as lookup while text selection is active', async () => {
    document.body.innerHTML = '<article><p>The unobtrusive article remains readable.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 }
    };
    vi.spyOn(document, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'unobtrusive',
      rangeCount: 0
    } as Selection);

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const eventWasNotCancelled = target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(eventWasNotCancelled).toBe(true);
    expect(onLookup).not.toHaveBeenCalled();
    expect(tooltipText()).toBe('');
    app.dispose();
  });

  it('lets pages opt out specific regions with qianci ignore markers', async () => {
    document.body.innerHTML = `
      <article>
        <p>The unobtrusive article remains readable.</p>
        <section class="qianci-ignore">The meticulous sidebar should stay untouched.</section>
        <aside data-qianci-ignore="true">The meticulous widget should stay untouched.</aside>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('p [data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect(document.querySelector('.qianci-ignore [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[data-qianci-ignore] [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('normalizes text nodes after automatic annotations are removed', async () => {
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const paragraph = document.querySelector('p') as HTMLParagraphElement;
    expect(paragraph.querySelectorAll('[data-qianci-word]')).toHaveLength(2);

    app.updateSiteMode('paused');

    expect(paragraph.querySelector('[data-qianci-word]')).toBeNull();
    expect(paragraph.textContent).toBe('The unobtrusive tool was meticulous.');
    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    app.dispose();
  });

  it('keeps virtual-list recycled rows to one annotation per visible word', async () => {
    document.body.innerHTML = '<article><div id="virtual-row">The unobtrusive virtual row is visible.</div></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const row = document.querySelector('#virtual-row') as HTMLDivElement;
    expect(row.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();

    row.textContent = 'The meticulous virtual row was reused.';
    await Promise.resolve();
    await flushScanWork();

    expect(row.querySelectorAll('[data-qianci-word]')).toHaveLength(1);
    expect(row.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(row.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(row.textContent).toBe('The meticulous virtual row was reused.');
    app.dispose();
  });

  it('removes existing annotations when a dynamic region becomes ignored', async () => {
    document.body.innerHTML = '<article><section id="widget">The meticulous widget starts as readable.</section></article>';

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

    const widget = document.querySelector('#widget') as HTMLElement;
    expect(widget.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();

    widget.classList.add('qianci-ignore');
    await Promise.resolve();
    await flushScanWork();

    expect(widget.querySelector('[data-qianci-word]')).toBeNull();
    expect(widget.textContent).toBe('The meticulous widget starts as readable.');
    expect(widget.childNodes).toHaveLength(1);
    app.dispose();
  });

  it('does not annotate inline style hidden regions', async () => {
    document.body.innerHTML = `
      <article>
        <p>The unobtrusive article remains readable.</p>
        <section style="display: none">The meticulous hidden panel is collapsed.</section>
        <section style="visibility: hidden">The meticulous invisible panel is collapsed.</section>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: vi.fn(async () => ({ message: '未使用' })),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    expect(document.querySelector('p [data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect(document.querySelector('[style*="display"] [data-qianci-word]')).toBeNull();
    expect(document.querySelector('[style*="visibility"] [data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('annotates inline style hidden regions after they become visible', async () => {
    document.body.innerHTML = `
      <article>
        <section id="style-panel" style="display: none">The meticulous hidden panel becomes visible.</section>
      </article>
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

    const panel = document.querySelector('#style-panel') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word]')).toBeNull();

    panel.style.display = '';
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips common css-class hidden regions and annotates after they become visible', async () => {
    document.body.innerHTML = `
      <article>
        <section id="bootstrap-hidden" class="d-none">The meticulous bootstrap hidden panel appears later.</section>
        <section id="tailwind-hidden" class="hidden">The meticulous tailwind hidden panel appears later.</section>
      </article>
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

    const bootstrapPanel = document.querySelector('#bootstrap-hidden') as HTMLElement;
    const tailwindPanel = document.querySelector('#tailwind-hidden') as HTMLElement;
    expect(bootstrapPanel.querySelector('[data-qianci-word]')).toBeNull();
    expect(tailwindPanel.querySelector('[data-qianci-word]')).toBeNull();

    bootstrapPanel.classList.remove('d-none');
    tailwindPanel.classList.remove('hidden');
    await Promise.resolve();
    await flushScanWork();

    expect(bootstrapPanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(tailwindPanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips closed details content and annotates it after the details element opens', async () => {
    document.body.innerHTML = `
      <article>
        <details id="details-panel">
          <summary>Open meticulous details</summary>
          <p>The meticulous collapsed paragraph appears later.</p>
        </details>
      </article>
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

    const details = document.querySelector('#details-panel') as HTMLDetailsElement;
    expect(details.querySelector('p [data-qianci-word]')).toBeNull();

    details.open = true;
    await Promise.resolve();
    await flushScanWork();

    expect(details.querySelector('p [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips closed dialog content and annotates it after the dialog opens', async () => {
    document.body.innerHTML = `
      <article>
        <dialog id="dialog-panel">
          <p>The meticulous dialog paragraph appears later.</p>
        </dialog>
      </article>
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

    const dialog = document.querySelector('#dialog-panel') as HTMLDialogElement;
    expect(dialog.querySelector('[data-qianci-word]')).toBeNull();

    dialog.open = true;
    await Promise.resolve();
    await flushScanWork();

    expect(dialog.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips aria-controlled collapsed panels and annotates them after expansion', async () => {
    document.body.innerHTML = `
      <article>
        <button aria-expanded="false" aria-controls="accordion-panel">Toggle panel</button>
        <section id="accordion-panel">
          <p>The meticulous accordion paragraph appears later.</p>
        </section>
      </article>
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

    const button = document.querySelector('button') as HTMLButtonElement;
    const panel = document.querySelector('#accordion-panel') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word]')).toBeNull();

    button.setAttribute('aria-expanded', 'true');
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips bootstrap collapsed panels and annotates them after show class is added', async () => {
    document.body.innerHTML = `
      <article>
        <section id="bootstrap-panel" class="collapse">
          <p>The meticulous bootstrap paragraph appears later.</p>
        </section>
      </article>
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

    const panel = document.querySelector('#bootstrap-panel') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word]')).toBeNull();

    panel.classList.add('show');
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('does not skip visible collapse panels when aria-expanded is stale', async () => {
    document.body.innerHTML = `
      <article>
        <button aria-expanded="false" aria-controls="visible-panel">Toggle stale panel</button>
        <section id="visible-panel" class="collapse show">
          <p>The meticulous visible paragraph should stay readable.</p>
        </section>
      </article>
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

    const panel = document.querySelector('#visible-panel') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips aria-selected false tab panels and annotates the selected panel', async () => {
    document.body.innerHTML = `
      <article>
        <div role="tablist">
          <button role="tab" aria-selected="true" aria-controls="active-tab">Active tab</button>
          <button role="tab" aria-selected="false" aria-controls="inactive-tab">Inactive tab</button>
        </div>
        <section id="active-tab" role="tabpanel">
          <p>The meticulous active paragraph is readable.</p>
        </section>
        <section id="inactive-tab" role="tabpanel">
          <p>The meticulous inactive paragraph appears later.</p>
        </section>
      </article>
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

    const activePanel = document.querySelector('#active-tab') as HTMLElement;
    const inactivePanel = document.querySelector('#inactive-tab') as HTMLElement;
    expect(activePanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(inactivePanel.querySelector('[data-qianci-word]')).toBeNull();

    document.querySelector('[aria-controls="active-tab"]')?.setAttribute('aria-selected', 'false');
    document.querySelector('[aria-controls="inactive-tab"]')?.setAttribute('aria-selected', 'true');
    await Promise.resolve();
    await flushScanWork();

    expect(activePanel.querySelector('[data-qianci-word]')).toBeNull();
    expect(inactivePanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('does not skip aria-selected false non-tab controlled regions', async () => {
    document.body.innerHTML = `
      <article>
        <button aria-selected="false" aria-controls="ordinary-panel">Ordinary control</button>
        <section id="ordinary-panel">
          <p>The meticulous ordinary paragraph is visible.</p>
        </section>
      </article>
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

    expect(document.querySelector('#ordinary-panel [data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('skips bootstrap inactive tab panes and annotates active panes', async () => {
    document.body.innerHTML = `
      <article>
        <section id="inactive-bootstrap-tab" class="tab-pane">
          <p>The meticulous inactive tab appears later.</p>
        </section>
        <section id="active-bootstrap-tab" class="tab-pane active show">
          <p>The meticulous active tab is readable.</p>
        </section>
      </article>
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

    const inactivePanel = document.querySelector('#inactive-bootstrap-tab') as HTMLElement;
    const activePanel = document.querySelector('#active-bootstrap-tab') as HTMLElement;
    expect(inactivePanel.querySelector('[data-qianci-word]')).toBeNull();
    expect(activePanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();

    inactivePanel.className = 'tab-pane active show';
    await Promise.resolve();
    await flushScanWork();

    expect(inactivePanel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('requires show for bootstrap fade active tab panes', async () => {
    document.body.innerHTML = `
      <article>
        <section id="fade-tab" class="tab-pane fade active">
          <p>The meticulous fade tab appears after transition.</p>
        </section>
      </article>
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

    const panel = document.querySelector('#fade-tab') as HTMLElement;
    expect(panel.querySelector('[data-qianci-word]')).toBeNull();

    panel.classList.add('show');
    await Promise.resolve();
    await flushScanWork();

    expect(panel.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });
});
