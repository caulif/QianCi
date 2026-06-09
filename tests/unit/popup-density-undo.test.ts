import { describe, expect, it, vi } from 'vitest';
import type { PageDiagnostics } from '../../src/core/messages';
import { createProfile } from '../../src/core/profile';
import { mountPopupApp } from '../../src/popup/main';
import { createMemoryStore, type KeyValueStore } from '../../src/storage/browserAdapter';
import { loadProfile } from '../../src/storage/profileStore';

describe('popup density undo', () => {
  async function flushPopupWork(): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }
  }

  it('lets users undo a quick density reduction without changing site mode', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });
    const rescanPage = vi.fn().mockResolvedValue(undefined);
    const diagnostics: PageDiagnostics = {
      siteMode: 'auto',
      annotatedWords: 18,
      scannedTextNodes: 42,
      pendingScan: false,
      lastScanAt: 100,
      lastScanDurationMs: 6,
      warnings: []
    };

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: vi.fn(async () => diagnostics)
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.click();
    await flushPopupWork();

    expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    expect(root.textContent).toContain('已调低标注密度');
    const undoButton = root.querySelector<HTMLButtonElement>('[data-qianci-undo-density]');
    expect(undoButton).not.toBeNull();
    expect(undoButton?.textContent).toBe('撤销密度调整');

    undoButton?.click();
    await flushPopupWork();

    expect((await loadProfile(store))?.annotationDensity).toBe(1);
    expect(root.textContent).toContain('已撤销标注密度调整');
    expect(root.querySelector('[data-qianci-site-mode="auto"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rescanPage).toHaveBeenCalledTimes(2);
  });

  it('prevents repeated density changes while the first save is still pending', async () => {
    const root = document.createElement('div');
    const baseStore = createMemoryStore({
      'qianci.profile': createProfile('cet4')
    });
    let releaseSave!: () => void;
    let setCalls = 0;
    const slowStore: KeyValueStore = {
      get: baseStore.get,
      remove: baseStore.remove,
      clear: baseStore.clear,
      async set(values) {
        setCalls += 1;
        await new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        await baseStore.set(values);
      }
    };
    const diagnostics: PageDiagnostics = {
      siteMode: 'auto',
      annotatedWords: 18,
      scannedTextNodes: 42,
      pendingScan: false,
      lastScanAt: 100,
      lastScanDurationMs: 6,
      warnings: []
    };

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store: slowStore,
      openOptions: vi.fn(),
      rescanPage: vi.fn(),
      getPageDiagnostics: vi.fn(async () => diagnostics)
    });

    const reduceButton = root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]');
    reduceButton?.click();
    reduceButton?.click();
    await Promise.resolve();

    expect(setCalls).toBe(1);
    expect(root.textContent).toContain('正在调整标注密度');
    expect(root.querySelector('.diagnostics-panel')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-reduce-density]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.disabled).toBe(true);

    releaseSave();
    await flushPopupWork();

    expect((await loadProfile(baseStore))?.annotationDensity).toBe(0.9);
  });
});
