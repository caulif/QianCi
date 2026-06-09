import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content app', () => {
  const RESCAN_DELAY_MS = 24;

  function createResolver(dictionary: Record<string, { word: string; phonetic: string; translation: string; rank: number }>) {
    return async (word: string) => dictionary[word];
  }

  function createOnlineLookup(entry?: DictionaryEntry, message = '已同步到词库') {
    return vi.fn(async () => ({ entry, message }));
  }

  function createProfileWithSkipDelay(skipDelayMs: number) {
    return {
      ...createProfile('starter'),
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs,
        suppressionMode: 'balanced'
      }
    } as unknown as ReturnType<typeof createProfile>;
  }

  function tooltipHost(): HTMLElement | null {
    return document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
  }

  function tooltipText(): string {
    const host = tooltipHost();
    return host?.shadowRoot?.textContent ?? host?.textContent ?? '';
  }

  function tooltipButton(): HTMLButtonElement | null {
    const host = tooltipHost();
    return (host?.shadowRoot?.querySelector('button') ?? host?.querySelector('button')) as HTMLButtonElement | null;
  }

  function tooltipButtonByText(label: string): HTMLButtonElement | null {
    const host = tooltipHost();
    const buttons = Array.from(host?.shadowRoot?.querySelectorAll('button') ?? host?.querySelectorAll('button') ?? []);
    return buttons.find((button) => button.textContent === label) as HTMLButtonElement | null;
  }

  function tooltipButtonByLabel(label: string): HTMLButtonElement | null {
    const host = tooltipHost();
    const buttons = Array.from(host?.shadowRoot?.querySelectorAll('button') ?? host?.querySelectorAll('button') ?? []);
    return (buttons.find((button) => button.getAttribute('aria-label') === label) as HTMLButtonElement | undefined) ?? null;
  }

  async function flushScanWork(): Promise<void> {
    vi.advanceTimersByTime(RESCAN_DELAY_MS);
    await Promise.resolve();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    }
  }

  async function flushSingleScanSlice(): Promise<void> {
    vi.advanceTimersByTime(RESCAN_DELAY_MS);
    await Promise.resolve();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scans prose, wraps predicted words, and shows a hover tooltip', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    const words = document.querySelectorAll('[data-qianci-word]');
    expect(words.length).toBe(2);

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    expect(target).not.toBeNull();
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(target.getAttribute('role')).toBe('button');
    expect(target.getAttribute('aria-label')).toBe('查看 unobtrusive 的释义');
    expect(target.getAttribute('aria-keyshortcuts')).toBe('Enter Space');
    expect(target.getAttribute('aria-haspopup')).toBe('dialog');
    expect(target.getAttribute('aria-expanded')).toBe('false');

    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    expect(tooltipText()).toContain('不唐突的');
    expect(tooltipText()).toContain('认识');
    expect(tooltipButtonByText('认识')?.getAttribute('aria-label')).toBe('标记 unobtrusive 为认识');
    expect(tooltipButtonByText('继续提醒')?.getAttribute('aria-label')).toBe('继续提醒 unobtrusive');
    app.dispose();
  });

  it('updates the annotated word expanded state while its lookup dialog is visible', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    expect(target.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(target.getAttribute('aria-expanded')).toBe('false');
    app.dispose();
  });

  it('collapses the previous annotated word when another lookup dialog opens', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const firstWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const secondWord = document.querySelector('[data-qianci-word="meticulous"]') as HTMLElement;
    firstWord.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    expect(firstWord.getAttribute('aria-expanded')).toBe('true');

    secondWord.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    expect(firstWord.getAttribute('aria-expanded')).toBe('false');
    expect(secondWord.getAttribute('aria-expanded')).toBe('true');
    app.dispose();
  });

  it('renders tooltip content inside shadow DOM while keeping a stable host marker', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltipHost = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    const shadowText = tooltipHost?.shadowRoot?.textContent;
    const shadowButtonText = tooltipHost?.shadowRoot?.querySelector('button')?.textContent;
    const hostText = tooltipHost?.textContent;
    app.dispose();

    expect(tooltipHost).not.toBeNull();
    expect(shadowText).toContain('不唐突的');
    expect(shadowButtonText).toBe('认识');
    expect(hostText).toBe('');
  });

  it('lets users report an inaccurate translation from the tooltip', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onTranslationFeedback = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn(),
      onTranslationFeedback
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const feedbackButton = tooltipButtonByText('释义不准') as HTMLButtonElement | null;
    expect(feedbackButton).not.toBeNull();
    feedbackButton?.click();
    await Promise.resolve();

    expect(onTranslationFeedback).toHaveBeenCalledWith(
      'unobtrusive',
      expect.objectContaining({ translation: '不唐突的；不显眼的' })
    );
    expect(tooltipText()).toContain('已记录释义问题');
    app.dispose();
  });

  it('exposes the interactive lookup card as a non-modal dialog', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const host = tooltipHost() as HTMLElement;
    const card = host.shadowRoot?.querySelector('.qianci-tooltip-card') as HTMLElement;
    expect(host.getAttribute('role')).toBe('dialog');
    expect(host.getAttribute('aria-modal')).toBe('false');
    expect(host.getAttribute('aria-label')).toBe('潜词查词卡片：unobtrusive');
    expect(card.getAttribute('role')).toBeNull();
    expect(tooltipButtonByText('认识')).not.toBeNull();
    app.dispose();
  });

  it('provides an explicit close button that returns focus for keyboard-opened lookup cards', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onAlwaysAnnotate = vi.fn();
    const onKnown = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown,
      onLookup: vi.fn(),
      onSkip: vi.fn(),
      onAlwaysAnnotate
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    const closeButton = tooltipButtonByLabel('关闭查词卡片') as HTMLButtonElement;
    expect(closeButton).not.toBeNull();
    expect(closeButton.className).toContain('qianci-tooltip-close');
    expect(closeButton.textContent).toBe('×');

    closeButton.click();

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    expect(onKnown).not.toHaveBeenCalled();
    expect(onAlwaysAnnotate).not.toHaveBeenCalled();
    app.dispose();
  });

  it('keeps tooltip action buttons large enough to operate comfortably', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const styleText = tooltipHost()?.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(styleText).toContain('min-width: 32px');
    expect(styleText).toContain('min-height: 32px');
    expect(styleText).toContain('button:focus-visible');
    expect(styleText).toContain('outline: 2px solid var(--qianci-focus-color');
    expect(styleText).toContain('outline-offset: 2px');
    expect(styleText).toContain('max-width: 136px');
    expect(styleText).toContain('.qianci-tooltip-close');
    app.dispose();
  });

  it('syncs tooltip button focus color with the underline tone', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), underlineTone: 'sky' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.getPropertyValue('--qianci-focus-color')).toBe('#5f7db9');

    app.updateProfile({ ...createProfile('starter'), underlineTone: 'amber' });

    expect(tooltip.style.getPropertyValue('--qianci-focus-color')).toBe('#9a6c35');
    app.dispose();
  });

  it('records weak skip feedback only when an annotated word is not hovered', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onSkip = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/x/', translation: '细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip
    });

    app.rescan();
    await flushScanWork();
    const hovered = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    hovered.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    vi.advanceTimersByTime(3600);
    await Promise.resolve();

    expect(onSkip).toHaveBeenCalledWith('meticulous', expect.any(String), expect.objectContaining({ level: 'starter' }));
    expect(onSkip).not.toHaveBeenCalledWith('unobtrusive', expect.any(String), expect.anything());
    app.dispose();
  });

  it('treats Alt mouse selection as an active lookup', async () => {
    document.body.innerHTML = '<article><p>The word serendipity is not underlined.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      serendipity: { word: 'serendipity', phonetic: '/ˌserənˈdɪpəti/', translation: '意外发现的美好', rank: 12300 }
    };

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => ' serendipity ',
      rangeCount: 0
    } as Selection);

    const app = createContentApp(document, {
      profile: createProfile('professional'),
      ranks: { serendipity: 12300 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await Promise.resolve();

    expect(onLookup).toHaveBeenCalledWith(
      'serendipity',
      'selection',
      expect.objectContaining({ level: 'professional' }),
      expect.objectContaining({ translation: '意外发现的美好' })
    );
    expect(tooltipText()).toContain('意外发现');
    app.dispose();
  });

  it('uses the configured shortcut modifier for manual lookup', async () => {
    document.body.innerHTML = '<article><p>The word serendipity is not underlined.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      serendipity: { word: 'serendipity', phonetic: '/ˌserənˈdɪpəti/', translation: '意外发现的美好', rank: 12300 }
    };

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => ' serendipity ',
      rangeCount: 0
    } as Selection);

    const app = createContentApp(document, {
      profile: { ...createProfile('professional'), manualShortcut: 'ctrl' },
      ranks: { serendipity: 12300 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await Promise.resolve();
    expect(onLookup).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent('mouseup', { ctrlKey: true, bubbles: true }));
    await Promise.resolve();

    expect(onLookup).toHaveBeenCalledWith(
      'serendipity',
      'selection',
      expect.objectContaining({ manualShortcut: 'ctrl' }),
      expect.objectContaining({ translation: '意外发现的美好' })
    );
    app.dispose();
  });

  it('uses click lookup mode for annotated words', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    expect(onLookup).not.toHaveBeenCalled();

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();

    expect(onLookup).toHaveBeenCalledWith(
      'unobtrusive',
      'click',
      expect.objectContaining({ lookupTrigger: 'click' }),
      expect.objectContaining({ translation: '不唐突的；不显眼的' })
    );
    expect(tooltipText()).toContain('不唐突的');
    expect(tooltipHost()?.shadowRoot?.activeElement).toBeNull();
    app.dispose();
  });

  it('shows an undo notice after users mark a hovered word as known', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onKnown = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown,
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltipText()).toContain('认识');
    expect(tooltip.shadowRoot?.activeElement).toBeNull();

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    tooltip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(180);
    await Promise.resolve();

    expect(tooltip.style.display).toBe('block');

    const knownButton = tooltipButton() as HTMLButtonElement;
    knownButton.click();
    await Promise.resolve();

    expect(onKnown).toHaveBeenCalledWith('unobtrusive', expect.objectContaining({ level: 'starter' }));
    expect(tooltip.style.display).toBe('block');
    expect(tooltipText()).toContain('已标为认识');
    expect(tooltipButtonByText('撤销')).not.toBeNull();
    app.dispose();
  });

  it('keeps the tooltip open while focus remains inside the lookup card', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    const tooltip = tooltipHost() as HTMLElement;
    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    knownButton.focus();

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(180);
    await Promise.resolve();

    expect(tooltip.style.display).toBe('block');
    expect(tooltip.shadowRoot?.activeElement).toBe(knownButton);
    app.dispose();
  });

  it('hides the tooltip after focus leaves the lookup card', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="after">after</button><article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const afterButton = document.querySelector('#after') as HTMLButtonElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    const tooltip = tooltipHost() as HTMLElement;
    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    knownButton.focus();
    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    vi.advanceTimersByTime(180);
    await Promise.resolve();
    expect(tooltip.style.display).toBe('block');

    afterButton.focus();
    vi.advanceTimersByTime(180);
    await Promise.resolve();

    expect(tooltip.style.display).toBe('none');
    app.dispose();
  });

  it('closes the tooltip with Escape for keyboard users', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.display).toBe('block');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    app.dispose();
  });

  it('closes a click-triggered tooltip with Escape without changing lookup behavior', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    expect(onLookup).not.toHaveBeenCalled();

    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.display).toBe('block');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    expect(onLookup).toHaveBeenCalledTimes(1);
    app.dispose();
  });

  it('opens an annotated word tooltip with Enter for keyboard users', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onLookup = vi.fn();
    const onKnown = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown,
      onLookup,
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const keydown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    target.dispatchEvent(keydown);
    await Promise.resolve();

    expect(keydown.defaultPrevented).toBe(true);
    expect(onLookup).toHaveBeenCalledWith(
      'unobtrusive',
      'click',
      expect.objectContaining({ level: 'starter' }),
      expect.objectContaining({ translation: '不唐突的；不显眼的' })
    );
    expect(tooltipText()).toContain('不唐突的');
    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(knownButton);

    knownButton.click();
    await Promise.resolve();

    expect(onKnown).toHaveBeenCalledWith('unobtrusive', expect.objectContaining({ level: 'starter' }));
    app.dispose();
  });

  it('returns focus to the annotated word when Escape closes a keyboard-opened tooltip', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.display).toBe('block');
    expect(tooltip.shadowRoot?.activeElement).toBe(tooltipButtonByText('认识'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    app.dispose();
  });

  it('does not move focus to the word when Escape closes a mouse-opened tooltip', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="before">before</button><article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const beforeButton = document.querySelector('#before') as HTMLButtonElement;
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    beforeButton.focus();
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.display).toBe('block');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(beforeButton);
    app.dispose();
  });

  it('opens an annotated word tooltip with Space and does not count it as skipped', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onLookup = vi.fn();
    const onSkip = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const keydown = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    target.dispatchEvent(keydown);
    await Promise.resolve();
    vi.advanceTimersByTime(3600);
    await Promise.resolve();

    expect(keydown.defaultPrevented).toBe(true);
    expect(onLookup).toHaveBeenCalledWith(
      'unobtrusive',
      'click',
      expect.objectContaining({ level: 'starter' }),
      expect.objectContaining({ translation: '不唐突的；不显眼的' })
    );
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(tooltipButtonByText('认识'));
    expect(onSkip).not.toHaveBeenCalledWith('unobtrusive', expect.any(String), expect.anything());
    expect(onSkip).toHaveBeenCalledWith('meticulous', expect.any(String), expect.objectContaining({ level: 'starter' }));
    app.dispose();
  });

  it('keeps tooltip keyboard controls after toggling automatic annotation back on', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    app.updateSiteMode('manual-only');
    app.updateSiteMode('auto');
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();
    const tooltip = tooltipHost() as HTMLElement;
    expect(tooltip.style.display).toBe('block');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    app.dispose();
  });

  it('lets users keep an annotated word visible from the tooltip', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onAlwaysAnnotate = vi.fn();
    const profile = {
      ...createProfile('starter'),
      words: {
        unobtrusive: {
          familiarity: 2,
          isKnown: false,
          isUnknown: false,
          lastSeenAt: 100,
          seenPages: { 'https://example.com/article': true as const }
        }
      }
    };
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile,
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn(),
      onAlwaysAnnotate
    });
    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const keepButton = tooltipButtonByText('继续提醒');
    expect(keepButton).not.toBeNull();
    keepButton?.click();
    await Promise.resolve();

    expect(onAlwaysAnnotate).toHaveBeenCalledWith(
      'unobtrusive',
      expect.objectContaining({
        words: expect.objectContaining({
          unobtrusive: expect.objectContaining({
            alwaysAnnotate: true,
            familiarity: 0,
            seenPages: {}
          })
        })
      })
    );
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect((tooltipHost() as HTMLElement).style.display).toBe('block');
    expect(tooltipText()).toContain('会继续提醒');
    expect(tooltipButtonByText('撤销')).not.toBeNull();
    app.dispose();
  });

  it('returns focus to the word after keyboard users choose continue reminding', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onAlwaysAnnotate = vi.fn();
    const profile = {
      ...createProfile('starter'),
      words: {
        unobtrusive: {
          familiarity: 2,
          isKnown: false,
          isUnknown: false,
          lastSeenAt: 100,
          seenPages: { 'https://example.com/article': true as const }
        }
      }
    };
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile,
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn(),
      onAlwaysAnnotate
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const keepButton = tooltipButtonByText('继续提醒') as HTMLButtonElement;
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(tooltipButtonByText('认识'));
    keepButton.focus();
    keepButton.click();
    await Promise.resolve();

    expect(onAlwaysAnnotate).toHaveBeenCalledWith('unobtrusive', expect.anything());
    expect((tooltipHost() as HTMLElement).style.display).toBe('block');
    expect(tooltipText()).toContain('会继续提醒');
    expect(document.activeElement).toBe(target);
    app.dispose();
  });

  it('moves focus to the next annotated word after keyboard users mark a word as known', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onKnown = vi.fn();
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown,
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const firstWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const nextWord = document.querySelector('[data-qianci-word="meticulous"]') as HTMLElement;
    firstWord.focus();
    firstWord.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    knownButton.click();
    await Promise.resolve();

    expect(onKnown).toHaveBeenCalledWith('unobtrusive', expect.anything());
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(document.activeElement).toBe(nextWord);
    app.dispose();
  });

  it('does not move page focus after mouse users mark a word as known', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="before">before</button><article><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const beforeButton = document.querySelector('#before') as HTMLButtonElement;
    const firstWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    beforeButton.focus();
    firstWord.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    knownButton.click();
    await Promise.resolve();

    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(document.activeElement).toBe(beforeButton);
    app.dispose();
  });

  it('moves focus to the nearest reading container when keyboard users mark the only word as known', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article id="story"><p>The unobtrusive tool was plain.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const onlyWord = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    const readingContainer = document.querySelector('#story p') as HTMLElement;
    onlyWord.focus();
    onlyWord.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const knownButton = tooltipButtonByText('认识') as HTMLButtonElement;
    knownButton.click();
    await Promise.resolve();

    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(document.activeElement).toBe(readingContainer);
    expect(readingContainer.getAttribute('tabindex')).toBe('-1');
    app.dispose();
  });

  it('shows a missing-word card and resolves it through online lookup', async () => {
    document.body.innerHTML = '<article><p>The word serendipity is not underlined.</p></article>';
    const onLookup = vi.fn();
    const lookupOnline = createOnlineLookup({
      word: 'serendipity',
      phonetic: '/ˌserənˈdɪpəti/',
      translation: '意外发现的美好',
      rank: 999999,
      source: 'online'
    });

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => ' serendipity ',
      rangeCount: 0
    } as Selection);

    const app = createContentApp(document, {
      profile: createProfile('professional'),
      ranks: {},
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await Promise.resolve();

    expect(tooltipText()).toContain('词库里没有');
    expect(tooltipHost()?.getAttribute('aria-busy')).toBe('false');
    expect(tooltipHost()?.shadowRoot?.querySelector('[role="status"]')).toBeNull();
    const lookupButton = tooltipButton() as HTMLButtonElement;
    expect(lookupButton.textContent).toContain('联网查询');
    expect(lookupButton.getAttribute('aria-label')).toBe('联网查询 serendipity');
    expect(lookupButton.onclick).not.toBeNull();
    lookupButton.onclick?.(new MouseEvent('click') as never);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(lookupOnline).toHaveBeenCalledWith('serendipity');
    expect(onLookup).toHaveBeenCalledWith(
      'serendipity',
      'selection',
      expect.objectContaining({ level: 'professional' }),
      expect.objectContaining({ translation: '意外发现的美好', source: 'online' })
    );
    expect(tooltipHost()?.getAttribute('aria-busy')).toBe('false');
    expect(tooltipText()).toContain('意外发现的美好');
    app.dispose();
  });

  it('focuses the online lookup action and returns focus for keyboard-opened missing-word cards', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    const lookupButton = tooltipButton() as HTMLButtonElement;
    expect(tooltipText()).toContain('词库里没有');
    expect(lookupButton.textContent).toContain('联网查询');
    expect(tooltip.shadowRoot?.activeElement).toBe(lookupButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    app.dispose();
  });

  it('provides an explicit close button for keyboard-opened missing-word cards', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const lookupOnline = createOnlineLookup();
    const onLookup = vi.fn();

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    const closeButton = tooltipButtonByLabel('关闭查词卡片') as HTMLButtonElement;
    expect(tooltipText()).toContain('词库里没有');
    expect(closeButton).not.toBeNull();

    closeButton.click();

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    expect(lookupOnline).not.toHaveBeenCalled();
    expect(onLookup).not.toHaveBeenCalled();
    app.dispose();
  });

  it('keeps keyboard focus context when online lookup still cannot find the word', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const lookupOnline = vi.fn(async () => ({ message: '暂时没有找到词条' }));

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const lookupButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(lookupButton);
    lookupButton.click();
    await Promise.resolve();
    await Promise.resolve();

    const retryButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    expect(lookupOnline).toHaveBeenCalledWith('unobtrusive');
    expect(tooltipText()).toContain('暂时没有找到词条');
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(retryButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect((tooltipHost() as HTMLElement).style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    app.dispose();
  });

  it('keeps keyboard focus context when online lookup throws', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const lookupOnline = vi.fn(async () => {
      throw new Error('network down');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const lookupButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    lookupButton.click();
    await Promise.resolve();
    await Promise.resolve();

    const retryButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(tooltipText()).toContain('联网查询失败');
    expect(tooltipHost()?.shadowRoot?.activeElement).toBe(retryButton);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect((tooltipHost() as HTMLElement).style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    app.dispose();
  });

  it('explains queued online lookup retries in the lookup card', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const lookupOnline = vi.fn(async () => ({
      message: '在线词典请求过于频繁，请稍后再试',
      errorKind: 'rate_limited' as const,
      queued: true
    }));

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    tooltipButtonByText('联网查询')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(lookupOnline).toHaveBeenCalledWith('unobtrusive');
    expect(tooltipText()).toContain('在线词典请求过于频繁');
    expect(tooltipText()).toContain('已加入重试队列，稍后自动重试');
    expect(tooltipText()).not.toContain('联网查询失败');
    app.dispose();
  });

  it('keeps the loading lookup card dismissible and returns focus for keyboard users', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    let resolveLookup: (value: { message: string }) => void = () => undefined;
    const lookupOnline = vi.fn(
      () =>
        new Promise<{ message: string }>((resolve) => {
          resolveLookup = resolve;
        })
    );

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const lookupButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    lookupButton.click();
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    const closeButton = tooltipButtonByLabel('关闭查词卡片') as HTMLButtonElement;
    expect(tooltipText()).toContain('正在联网查询');
    expect(closeButton).not.toBeNull();
    expect(tooltip.shadowRoot?.activeElement).toBe(closeButton);

    closeButton.click();

    expect(tooltip.style.display).toBe('none');
    expect(document.activeElement).toBe(target);
    resolveLookup({ message: '暂时没有找到词条' });
    await Promise.resolve();
    await Promise.resolve();
    expect(tooltip.style.display).toBe('none');
    app.dispose();
  });

  it('exposes online lookup loading and failure states to assistive technology', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    let resolveLookup: (value: { message: string }) => void = () => undefined;
    const lookupOnline = vi.fn(
      () =>
        new Promise<{ message: string }>((resolve) => {
          resolveLookup = resolve;
        })
    );

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline,
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const lookupButton = tooltipButtonByText('联网查询') as HTMLButtonElement;
    lookupButton.click();
    await Promise.resolve();

    const tooltip = tooltipHost() as HTMLElement;
    const loadingStatus = tooltip.shadowRoot?.querySelector('[role="status"]') as HTMLElement;
    expect(tooltip.getAttribute('aria-busy')).toBe('true');
    expect(loadingStatus.textContent).toContain('正在联网查询');
    expect(loadingStatus.getAttribute('aria-live')).toBe('polite');

    resolveLookup({ message: '暂时没有找到词条' });
    await Promise.resolve();
    await Promise.resolve();

    const failureStatus = tooltip.shadowRoot?.querySelector('[role="status"]') as HTMLElement;
    expect(tooltip.getAttribute('aria-busy')).toBe('false');
    expect(failureStatus.textContent).toContain('暂时没有找到词条');
    expect(failureStatus.getAttribute('aria-live')).toBe('polite');
    app.dispose();
  });

  it('annotates newly inserted prose after the initial scan', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article id="root"><p>The unobtrusive tool was meticulous.</p></article>';
    const dictionary = {
      unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 },
      meticulous: { word: 'meticulous', phonetic: '/x/', translation: '细致的', rank: 9200 }
    };

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    expect(document.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);

    const extra = document.createElement('p');
    extra.textContent = 'Another meticulous reader noticed the unobtrusive cue.';
    document.querySelector('#root')?.append(extra);

    await Promise.resolve();
    await flushScanWork();

    expect(extra.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(extra.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    app.dispose();
  });

  it('annotates text inside discovered open shadow roots', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><qianci-test-reader></qianci-test-reader></article>';
    const host = document.querySelector('qianci-test-reader') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<p>The meticulous reader noticed the unobtrusive cue.</p>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    expect(shadowRoot.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(shadowRoot.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    app.dispose();
  });

  it('observes new text inserted into discovered open shadow roots', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><qianci-test-reader></qianci-test-reader></article>';
    const host = document.querySelector('qianci-test-reader') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<p>The simple reader waited.</p>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    const extra = document.createElement('p');
    extra.textContent = 'The meticulous reader noticed the unobtrusive cue.';
    shadowRoot.append(extra);
    await Promise.resolve();
    await flushScanWork();

    expect(extra.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(extra.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    app.dispose();
  });

  it('clears annotations and stops automatic rescans when paused', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article id="root"><p>The meticulous reader noticed the unobtrusive cue.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(2);

    app.updateSiteMode('paused');
    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(0);
    expect(document.body.textContent).toContain('meticulous');

    const extra = document.createElement('p');
    extra.textContent = 'Another meticulous reader noticed the unobtrusive cue.';
    document.querySelector('#root')?.append(extra);
    await Promise.resolve();
    await flushScanWork();

    expect(extra.querySelector('[data-qianci-word]')).toBeNull();
    app.dispose();
  });

  it('clears annotations inside open shadow roots when paused', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><qianci-test-reader></qianci-test-reader></article>';
    const host = document.querySelector('qianci-test-reader') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<p>The meticulous reader noticed the unobtrusive cue.</p>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'auto',
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    expect(shadowRoot.querySelectorAll('[data-qianci-word]')).toHaveLength(2);

    app.updateSiteMode('paused');

    expect(shadowRoot.querySelector('[data-qianci-word]')).toBeNull();
    expect(shadowRoot.textContent).toContain('meticulous');
    app.dispose();
  });

  it('keeps manual lookup available in manual-only mode and rescans when automatic mode returns', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The word serendipity is not underlined.</p><p>The meticulous cue appears.</p></article>';
    const onLookup = vi.fn();
    const dictionary = {
      serendipity: { word: 'serendipity', phonetic: '/x/', translation: '意外发现的美好', rank: 12300 }
    };
    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => ' serendipity ',
      rangeCount: 0
    } as Selection);

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      siteMode: 'manual-only',
      ranks: { meticulous: 9200 },
      resolveEntry: createResolver(dictionary),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();
    expect(document.querySelector('[data-qianci-word="meticulous"]')).toBeNull();

    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await Promise.resolve();
    expect(onLookup).toHaveBeenCalledWith(
      'serendipity',
      'selection',
      expect.objectContaining({ level: 'starter' }),
      expect.objectContaining({ translation: '意外发现的美好' })
    );

    app.updateSiteMode('auto');
    await flushScanWork();
    expect(document.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    app.dispose();
  });

  it('uses a shared skip-feedback timer instead of one timer per annotated word', async () => {
    vi.useFakeTimers();
    const phrases = Array.from({ length: 120 }, () => 'The unobtrusive tool was meticulous.');
    document.body.innerHTML = `<article><p>${phrases.join(' ')}</p></article>`;
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { unobtrusive: 8100, meticulous: 9200 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    expect(document.querySelectorAll('[data-qianci-word]').length).toBeGreaterThan(100);
    expect(setTimeoutSpy.mock.calls.length).toBeLessThan(10);
    app.dispose();
  });

  it('uses custom feedbackSettings.skipDelayMs for weak skip feedback', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The meticulous reader noticed the unobtrusive cue.</p></article>';
    const onSkip = vi.fn();

    const app = createContentApp(document, {
      profile: createProfileWithSkipDelay(1000),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip
    });

    app.rescan();
    await flushScanWork();
    onSkip.mockClear();

    vi.advanceTimersByTime(900);
    await Promise.resolve();
    expect(onSkip).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(onSkip).toHaveBeenCalledWith('meticulous', expect.any(String), expect.objectContaining({ level: 'starter' }));
    app.dispose();
  });

  it('schedules full rescan work instead of annotating synchronously', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The meticulous reader noticed the unobtrusive cue.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(0);

    await flushScanWork();
    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(2);
    app.dispose();
  });

  it('reports page diagnostics for popup self-check', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The meticulous reader noticed the unobtrusive cue.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    const diagnostics = app.getDiagnostics();
    expect(diagnostics.siteMode).toBe('auto');
    expect(diagnostics.annotatedWords).toBe(2);
    expect(diagnostics.scannedTextNodes).toBeGreaterThan(0);
    expect(diagnostics.pendingScan).toBe(false);
    expect(diagnostics.lastScanAt).toBeGreaterThan(0);
    app.dispose();
  });

  it('warns when the page looks like an editor, form, or code-heavy surface', () => {
    document.body.innerHTML = `
      <main>
        <div contenteditable="true">Draft text</div>
        <input type="text" value="search" />
        <textarea>notes</textarea>
        <pre><code>const value = computeResult();</code></pre>
        <pre><code>function renderWidget() { return null; }</code></pre>
      </main>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: {},
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    const diagnostics = app.getDiagnostics();
    expect(diagnostics.warnings).toContain('editor-detected');
    expect(diagnostics.warnings).toContain('form-heavy');
    expect(diagnostics.warnings).toContain('code-heavy');
    app.dispose();
  });

  it('does not warn for ordinary articles with one search box and inline code', () => {
    document.body.innerHTML = `
      <article>
        <input type="search" value="find" />
        <p>Use <code>map</code>, <code>filter</code>, and <code>reduce</code> carefully.</p>
        <div contenteditable="false">Rendered article text</div>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: {},
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    const diagnostics = app.getDiagnostics();
    expect(diagnostics.warnings).not.toContain('editor-detected');
    expect(diagnostics.warnings).not.toContain('form-heavy');
    expect(diagnostics.warnings).not.toContain('code-heavy');
    app.dispose();
  });

  it('cancels pending scan work when disposed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The meticulous reader noticed the unobtrusive cue.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    app.dispose();
    await flushScanWork();

    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(0);
  });

  it('chunks traversal itself across multiple scan slices', async () => {
    vi.useFakeTimers();
    const originalNow = performance.now.bind(performance);
    const nowSpy = vi.spyOn(performance, 'now');
    let callCount = 0;
    nowSpy.mockImplementation(() => {
      callCount += 1;
      return callCount <= 4 ? 0 : 10;
    });
    document.body.innerHTML = `
      <article>
        <p>The meticulous reader noticed the unobtrusive cue.</p>
        <p>The meticulous reader noticed the unobtrusive cue.</p>
      </article>
    `;

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushSingleScanSlice();
    const firstSliceCount = document.querySelectorAll('[data-qianci-word]').length;
    expect(firstSliceCount).toBeLessThan(4);

    nowSpy.mockImplementation(originalNow);
    await flushScanWork();
    expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(4);
    app.dispose();
  });

  it('does not miss DOM inserted while scan work is still pending', async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, 'now');
    let callCount = 0;
    nowSpy.mockImplementation(() => {
      callCount += 1;
      return callCount <= 4 ? 0 : 10;
    });
    document.body.innerHTML = '<article id="root"><p>The meticulous reader noticed the unobtrusive cue.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      ranks: { meticulous: 9200, unobtrusive: 8100 },
      resolveEntry: createResolver({}),
      lookupOnline: createOnlineLookup(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushSingleScanSlice();

    const extra = document.createElement('p');
    extra.textContent = 'Another meticulous reader noticed the unobtrusive cue.';
    document.querySelector('#root')?.append(extra);
    await Promise.resolve();

    nowSpy.mockRestore();
    await flushScanWork();

    expect(extra.querySelectorAll('[data-qianci-word]')).toHaveLength(2);
    app.dispose();
  });
});
