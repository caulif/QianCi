import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContentApp } from '../../src/content/app';
import { createProfile } from '../../src/core/profile';
import type { SiteMode } from '../../src/core/types';

/**
 * E1: site mode × lookup matrix (auto / low-density / safe / manual-only / paused).
 */
describe('site mode lookup matrix', () => {
  const RESCAN_DELAY_MS = 24;

  async function flushScanWork(): Promise<void> {
    vi.advanceTimersByTime(RESCAN_DELAY_MS);
    await Promise.resolve();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    }
  }

  async function flushLookupWork(): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mount(mode: SiteMode) {
    document.body.innerHTML = '<article><p>The unobtrusive tool was meticulous.</p></article>';
    const onLookup = vi.fn();
    const app = createContentApp(document, {
      profile: { ...createProfile('starter'), lookupTrigger: 'click' },
      siteMode: mode,
      ranks: { unobtrusive: 8100 },
      resolveEntry: async () => ({
        word: 'unobtrusive',
        phonetic: '',
        translation: '不唐突的',
        rank: 8100,
        source: 'bundled'
      }),
      lookupOnline: vi.fn(async () => ({ message: 'unused' })),
      onKnown: vi.fn(),
      onLookup,
      onSkip: vi.fn()
    });
    return { app, onLookup };
  }

  it('auto/low-density/safe annotate and allow click lookup', async () => {
    for (const mode of ['auto', 'low-density', 'safe'] as SiteMode[]) {
      document.body.innerHTML = '';
      const { app, onLookup } = mount(mode);
      app.rescan();
      await flushScanWork();
      const target = document.querySelector('[data-qianci-word="unobtrusive"]') as HTMLElement | null;
      expect(target, mode).not.toBeNull();
      window.getSelection()?.removeAllRanges();
      target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushLookupWork();
      expect(onLookup, mode).toHaveBeenCalled();
      app.dispose();
    }
  });

  it('manual-only does not auto-annotate but still allows selection lookup', async () => {
    const { app, onLookup } = mount('manual-only');
    app.rescan();
    await flushScanWork();
    expect(document.querySelector('[data-qianci-word]')).toBeNull();

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => 'unobtrusive',
      rangeCount: 0,
      isCollapsed: true
    } as Selection);
    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await flushLookupWork();
    expect(onLookup).toHaveBeenCalledWith(
      'unobtrusive',
      'selection',
      expect.anything(),
      expect.objectContaining({ translation: '不唐突的' })
    );
    app.dispose();
  });

  it('paused blocks manual selection lookup', async () => {
    const { app, onLookup } = mount('paused');
    app.rescan();
    await flushScanWork();
    expect(document.querySelector('[data-qianci-word]')).toBeNull();

    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => 'unobtrusive',
      rangeCount: 0,
      isCollapsed: true
    } as Selection);
    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true, bubbles: true }));
    await flushLookupWork();
    expect(onLookup).not.toHaveBeenCalled();
    app.dispose();
  });
});
