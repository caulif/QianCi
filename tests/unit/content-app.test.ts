import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import { createProfile } from '../../src/core/profile';

describe('content app', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('scans prose, wraps predicted words, and shows a hover tooltip', () => {
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      dictionary: {
        unobtrusive: { word: 'unobtrusive', phonetic: '/ˌʌnəbˈtruːsɪv/', translation: '不唐突的；不显眼的', rank: 8100 },
        meticulous: { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '一丝不苟的；细致的', rank: 9200 }
      },
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

    const tooltip = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    expect(tooltip?.textContent).toContain('不唐突的');
    expect(tooltip?.textContent).toContain('认识');
  });

  it('records weak skip feedback only when an annotated word is not hovered', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onSkip = vi.fn();

    const app = createContentApp(document, {
      profile: createProfile('starter'),
      dictionary: {
        unobtrusive: { word: 'unobtrusive', phonetic: '/x/', translation: '不显眼的', rank: 8100 },
        meticulous: { word: 'meticulous', phonetic: '/x/', translation: '细致的', rank: 9200 }
      },
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
  });

  it('treats Alt mouse selection as an active lookup', () => {
    document.body.innerHTML = '<article><p>The word serendipity is not underlined.</p></article>';
    const onLookup = vi.fn();

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => ' serendipity ',
      rangeCount: 0
    } as Selection);

    createContentApp(document, {
      profile: createProfile('professional'),
      dictionary: {
        serendipity: { word: 'serendipity', phonetic: '/ˌserənˈdɪpəti/', translation: '意外发现的美好', rank: 12300 }
      },
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });

    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));

    expect(onLookup).toHaveBeenCalledWith('serendipity', 'alt', expect.objectContaining({ level: 'professional' }));
    expect(document.querySelector('[data-qianci-tooltip]')?.textContent).toContain('意外发现');
  });
});
