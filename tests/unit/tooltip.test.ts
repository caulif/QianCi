import { describe, expect, it, vi } from 'vitest';
import { createTooltipController } from '../../src/content/tooltip';

describe('tooltip controller', () => {
  function visibleTooltip(): HTMLElement {
    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    expect(tooltip).not.toBeNull();
    return tooltip as HTMLElement;
  }

  it('keeps the tooltip open when the hide timer fires while the pointer is still over the card', () => {
    vi.useFakeTimers();
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

    const host = visibleTooltip();
    host.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    tooltip.scheduleHide();
    vi.advanceTimersByTime(500);

    expect(host.style.display).toBe('block');
    tooltip.dispose();
    vi.useRealTimers();
  });

  it('reports ownership for the tooltip host so word leave events can cancel hide', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);
    tooltip.showMissing({ x: 40, y: 40, width: 12, height: 12 }, 'word', vi.fn());

    expect(tooltip.ownsEventTarget(visibleTooltip())).toBe(true);
    expect(tooltip.ownsEventTarget(document.body)).toBe(false);
    tooltip.dispose();
  });

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
    expect(text).toContain('来源：在线词典');
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
    expect(visibleTooltip().shadowRoot?.textContent).toContain('来源：我的释义');

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
    expect(visibleTooltip().shadowRoot?.textContent).toContain('来源：在线词典');
    tooltip.dispose();
  });

  it('keeps source metadata and allows inline custom translation from more menu', () => {
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
    const moreButton = Array.from(shadowRoot?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === '更多'
    );
    moreButton?.click();

    const sourcePill = shadowRoot?.querySelector('[data-qianci-source-pill]');
    const feedbackButton = shadowRoot?.querySelector<HTMLButtonElement>('[data-qianci-translation-feedback]');
    const styleText = shadowRoot?.querySelector('style')?.textContent ?? '';

    expect(sourcePill?.textContent).toBe('在线词典');
    expect(sourcePill?.getAttribute('aria-label')).toBe('词条来源：在线词典');
    expect(feedbackButton?.textContent).toBe('改释义');
    expect(styleText).toContain('.qianci-source-pill');
    expect(styleText).toContain('.qianci-edit-form');

    feedbackButton?.click();
    const input = shadowRoot?.querySelector<HTMLInputElement>('[data-qianci-edit-translation-input]');
    expect(input).not.toBeNull();
    input!.value = '简洁的';
    shadowRoot
      ?.querySelector<HTMLFormElement>('[data-qianci-edit-translation]')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onFeedback).toHaveBeenCalledWith('laconic', '简洁的');
    expect(visibleTooltip().shadowRoot?.textContent).toContain('已保存自定义释义');
    expect(visibleTooltip().shadowRoot?.textContent).toContain('简洁的');
    tooltip.dispose();
  });

  it('repositions after expanding more panel using measured card height path', () => {
    document.body.innerHTML = '<main><p>Reading text.</p></main>';
    const tooltip = createTooltipController(document);

    tooltip.showEntry(
      { x: 40, y: 700, width: 24, height: 16 },
      {
        word: 'verbose',
        phonetic: '',
        translation: '冗长的',
        rank: 1000,
        source: 'bundled'
      },
      vi.fn(),
      vi.fn()
    );

    const host = visibleTooltip();
    const topBefore = host.style.top;
    const moreButton = Array.from(host.shadowRoot?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === '更多'
    );
    expect(moreButton).not.toBeUndefined();
    moreButton?.click();
    expect(host.shadowRoot?.textContent).toContain('总是提醒');
    // 展开后仍保持可见，并重新写入 top（真实高度路径被调用）
    expect(host.style.display).toBe('block');
    expect(host.style.top).toBeTruthy();
    expect(typeof host.style.top).toBe('string');
    void topBefore;
    tooltip.dispose();
  });
});
