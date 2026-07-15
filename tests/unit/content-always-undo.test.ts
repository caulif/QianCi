import { describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import type { DictionaryEntry } from '../../src/core/dictionaryEntry';
import { createProfile } from '../../src/core/profile';
import type { UserProfile } from '../../src/core/types';

describe('content always annotate undo', () => {
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

  it('lets users undo choosing continue reminding for a word', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const entry: DictionaryEntry = {
      word: 'unobtrusive',
      phonetic: '/ˌʌnəbˈtruːsɪv/',
      translation: '不唐突的；不显眼的',
      rank: 8100
    };
    const profile = {
      ...createProfile('starter'),
      lookupTrigger: 'click',
      words: {
        unobtrusive: {
          familiarity: 2,
          isKnown: false,
          isUnknown: false,
          lastSeenAt: 100,
          seenPages: { 'https://example.com/article': true }
        }
      }
    } as UserProfile;
    const onAlwaysAnnotate = vi.fn();
    const onUndoAlwaysAnnotate = vi.fn();

    const app = createContentApp(document, {
      profile,
      ranks: { unobtrusive: 8100 },
      resolveEntry: vi.fn(async (word: string) => (word === 'unobtrusive' ? entry : undefined)),
      lookupOnline: vi.fn(),
      onKnown: vi.fn(),
      onLookup: vi.fn(),
      onSkip: vi.fn(),
      onAlwaysAnnotate,
      onUndoAlwaysAnnotate
    });

    app.rescan();
    await flushScanWork();

    const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement;
    target.click();
    await Promise.resolve();
    tooltipButtonByText('总是提醒')?.click();
    await Promise.resolve();

    expect(onAlwaysAnnotate).toHaveBeenCalledWith(
      'unobtrusive',
      expect.objectContaining({
        words: expect.objectContaining({
          unobtrusive: expect.objectContaining({ alwaysAnnotate: true, familiarity: 0, seenPages: {} })
        })
      })
    );
    expect(tooltipText()).toContain('已设为总是提醒');
    expect(tooltipButtonByText('撤销')).not.toBeNull();

    tooltipButtonByText('撤销')?.click();
    await Promise.resolve();

    expect(onUndoAlwaysAnnotate).toHaveBeenCalledWith(
      'unobtrusive',
      expect.objectContaining({
        words: expect.objectContaining({
          unobtrusive: expect.objectContaining({ familiarity: 2, alwaysAnnotate: false })
        })
      })
    );
    expect(tooltipText()).not.toContain('已设为总是提醒');
    expect(document.querySelector('[data-qianci-word="unobtrusive"]')).not.toBeNull();
    app.dispose();
  });
});
