import { describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';
import type { UserProfile } from '../../src/core/types';

describe('content known undo', () => {
  const RESCAN_DELAY_MS = 24;

  async function flushScanWork(): Promise<void> {
    vi.advanceTimersByTime(RESCAN_DELAY_MS);
    await Promise.resolve();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    }
  }

  function tooltipText(): string {
    const host = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    return host?.shadowRoot?.textContent ?? '';
  }

  function tooltipButtonByText(label: string): HTMLButtonElement | null {
    const host = document.querySelector('[data-qianci-tooltip]') as HTMLElement | null;
    const buttons = Array.from(host?.shadowRoot?.querySelectorAll('button') ?? []);
    return (buttons.find((button) => button.textContent === label) as HTMLButtonElement | undefined) ?? null;
  }

  it('lets users undo marking a word as known and restores the annotation', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const entry: DictionaryEntry = {
      word: 'unobtrusive',
      phonetic: '/ˌʌnəbˈtruːsɪv/',
      translation: '不唐突的；不显眼的',
      rank: 8100
    };
    const onKnown = vi.fn();
    const onUndoKnown = vi.fn();

    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' } as UserProfile,
      ranks: { unobtrusive: 8100 },
      resolveEntry: vi.fn(async (word: string) => (word === 'unobtrusive' ? entry : undefined)),
      lookupOnline: vi.fn(),
      onKnown,
      onUndoKnown,
      onLookup: vi.fn(),
      onSkip: vi.fn()
    });

    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.click();
    await Promise.resolve();
    tooltipButtonByText('认识')?.click();
    await Promise.resolve();

    expect(onKnown).toHaveBeenCalledWith(
      'unobtrusive',
      expect.objectContaining({
        words: expect.objectContaining({
          unobtrusive: expect.objectContaining({ isKnown: true })
        })
      })
    );
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).toBeNull();
    expect(tooltipText()).toContain('已标为认识');
    expect(tooltipButtonByText('撤销')).not.toBeNull();

    tooltipButtonByText('撤销')?.click();
    await Promise.resolve();
    await flushScanWork();

    expect(onUndoKnown).toHaveBeenCalledWith('unobtrusive', expect.anything(), entry);
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    expect(tooltipText()).not.toContain('已标为认识');
    app.dispose();
  });
});
