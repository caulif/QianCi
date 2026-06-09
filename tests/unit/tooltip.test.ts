import { describe, expect, it, vi } from 'vitest';
import { createTooltipController } from '../../src/content/tooltip';

describe('tooltip controller', () => {
  function visibleTooltip(): HTMLElement {
    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    return tooltip as HTMLElement;
  }

  it('closes a visible tooltip when the user clicks elsewhere on the page', () => {
    document.body.innerHTML = '<main><button id="outside">继续阅读</button></main>';
    const tooltip = createTooltipController(document);

    tooltip.showMissing({ x: 120, y: 80, width: 20, height: 18 }, 'unobtrusive', vi.fn());
    expect(visibleTooltip().style.display).toBe('block');

    document.querySelector('#outside')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));

    expect(visibleTooltip().style.display).toBe('none');
    tooltip.dispose();
  });

  it('keeps the tooltip open when the user clicks inside its shadow content', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'unobtrusive',
        phonetic: '/ˌʌnəbˈtruːsɪv/',
        translation: '不唐突的；不显眼的',
        rank: 8100
      },
      vi.fn(),
      vi.fn()
    );

    const knownButton = visibleTooltip().shadowRoot?.querySelector('button') as HTMLButtonElement | null;
    expect(knownButton).not.toBeNull();
    knownButton?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));

    expect(visibleTooltip().style.display).toBe('block');
    tooltip.dispose();
  });

  it('shows both dictionary and translation service attribution', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'resilient',
        phonetic: '/rɪˈzɪliənt/',
        translation: '能从困难中快速恢复的',
        rank: 999999,
        source: 'online',
        attribution: {
          label: 'Wiktionary',
          url: 'https://en.wiktionary.org/wiki/resilient',
          serviceLabel: 'dictionaryapi.dev',
          serviceUrl: 'https://dictionaryapi.dev/',
          translationServiceLabel: 'MyMemory',
          translationServiceUrl: 'https://mymemory.translated.net/'
        }
      } as never,
      vi.fn(),
      vi.fn()
    );

    const text = visibleTooltip().shadowRoot?.textContent ?? '';
    const links = Array.from(visibleTooltip().shadowRoot?.querySelectorAll('a') ?? []);
    expect(text).toContain('Wiktionary');
    expect(text).toContain('dictionaryapi.dev');
    expect(text).toContain('中文：MyMemory');
    expect(text).toContain('来源：在线缓存');
    expect(links.map((link) => link.getAttribute('href'))).toContain('https://mymemory.translated.net/');
    tooltip.dispose();
  });

  it('shows a readable source label for bundled dictionary entries', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'unobtrusive',
        phonetic: '/ˌʌnəbˈtruːsɪv/',
        translation: '不唐突的；不显眼的',
        rank: 8100,
        source: 'bundled'
      },
      vi.fn(),
      vi.fn()
    );

    expect(visibleTooltip().shadowRoot?.textContent).toContain('来源：本地词库');
    tooltip.dispose();
  });

  it('distinguishes custom entries and cached online entries', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'bespoke',
        phonetic: '',
        translation: '定制的',
        rank: 12000,
        source: 'custom'
      },
      vi.fn(),
      vi.fn()
    );
    expect(visibleTooltip().shadowRoot?.textContent).toContain('来源：用户自定义');

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'serendipity',
        phonetic: '',
        translation: '意外发现的美好',
        rank: 999999,
        source: 'online'
      },
      vi.fn(),
      vi.fn()
    );
    expect(visibleTooltip().shadowRoot?.textContent).toContain('来源：在线缓存');
    tooltip.dispose();
  });

  it('renders source as a compact pill and exposes a subtle translation feedback action', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);
    const onFeedback = vi.fn();

    tooltip.showEntry(
      { x: 120, y: 80, width: 20, height: 18 },
      {
        word: 'laconic',
        phonetic: '/ləˈkɑːnɪk/',
        translation: '言简意赅的',
        rank: 999999,
        source: 'online'
      },
      vi.fn(),
      vi.fn(),
      { onTranslationFeedback: onFeedback }
    );

    const shadowRoot = visibleTooltip().shadowRoot;
    const sourcePill = shadowRoot?.querySelector('[data-qianci-source-pill]');
    const feedbackButton = shadowRoot?.querySelector<HTMLButtonElement>('[data-qianci-translation-feedback]');
    const styleText = shadowRoot?.querySelector('style')?.textContent ?? '';

    expect(sourcePill?.textContent).toBe('在线缓存');
    expect(sourcePill?.getAttribute('aria-label')).toBe('词条来源：在线缓存');
    expect(feedbackButton?.textContent).toBe('释义不准');
    expect(feedbackButton?.getAttribute('aria-label')).toBe('反馈 laconic 的释义不准');
    expect(styleText).toContain('.qianci-source-pill');
    expect(styleText).toContain('.qianci-feedback-link');

    feedbackButton?.click();

    expect(onFeedback).toHaveBeenCalledWith('laconic');
    expect(visibleTooltip().shadowRoot?.textContent).toContain('已记录释义问题');
    tooltip.dispose();
  });
});
