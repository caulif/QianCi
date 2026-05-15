import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';

describe('content app', () => {
  function createResolver(dictionary: Record<string, { word: string; phonetic: string; translation: string; rank: number }>) {
    return async (word: string) => dictionary[word];
  }

  function createOnlineLookup(entry?: DictionaryEntry, message = '已同步到词库') {
    return vi.fn(async () => ({ entry, message }));
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('scans prose, wraps predicted words, and shows a hover tooltip', async () => {
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

    const words = document.querySelectorAll('[data-qianci-word]');
    expect(words.length).toBe(2);

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    expect(target).not.toBeNull();

    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    expect(tooltip?.textContent).toContain('不唐突的');
    expect(tooltip?.textContent).toContain('认识');
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
    expect(document.querySelector('[data-qianci-tooltip]')?.textContent).toContain('意外发现');
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
    expect(document.querySelector('[data-qianci-tooltip]')?.textContent).toContain('不唐突的');
    app.dispose();
  });

  it('keeps the tooltip open when moving the pointer from the word to the tooltip', async () => {
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

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await Promise.resolve();

    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement;
    expect(tooltip?.textContent).toContain('认识');

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    tooltip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    vi.advanceTimersByTime(180);
    await Promise.resolve();

    expect(tooltip.style.display).toBe('block');

    const knownButton = tooltip.querySelector('button') as HTMLButtonElement;
    knownButton.click();
    await Promise.resolve();

    expect(onKnown).toHaveBeenCalledWith('unobtrusive', expect.objectContaining({ level: 'starter' }));
    expect(tooltip.style.display).toBe('none');
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

    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement;
    expect(tooltip.textContent).toContain('词库里没有');
    const lookupButton = tooltip.querySelector('button') as HTMLButtonElement;
    expect(lookupButton.textContent).toContain('联网查询');
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
    expect(tooltip.textContent).toContain('意外发现的美好');
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
    expect(document.querySelectorAll('[data-qianci-word="meticulous"]')).toHaveLength(1);

    const extra = document.createElement('p');
    extra.textContent = 'Another meticulous reader noticed the unobtrusive cue.';
    document.querySelector('#root')?.append(extra);

    await Promise.resolve();
    vi.advanceTimersByTime(40);
    await Promise.resolve();

    expect(extra.querySelector('[data-qianci-word="meticulous"]')).not.toBeNull();
    expect(extra.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    app.dispose();
  });

  it('uses a shared skip-feedback timer instead of one timer per annotated word', () => {
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

    expect(document.querySelectorAll('[data-qianci-word]').length).toBeGreaterThan(100);
    expect(setTimeoutSpy.mock.calls.length).toBeLessThan(10);
    app.dispose();
  });
});
