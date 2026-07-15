import { describe, expect, it, vi } from 'vitest';
import type { PageDiagnostics } from '../../src/core/messages';
import { createProfile } from '../../src/core/profile';
import { mountPopupApp } from '../../src/popup/main';
import { createMemoryStore, type KeyValueStore } from '../../src/storage/browserAdapter';
import { loadProfile } from '../../src/storage/profileStore';
import { SITE_POLICIES_KEY } from '../../src/storage/sitePolicyStore';

describe('popup density undo', () => {
  async function flushPopupWork(): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await Promise.resolve();
    }
  }

  const lowDensityPolicies = {
    [SITE_POLICIES_KEY]: {
      'example.com': {
        mode: 'low-density' as const,
        updatedAt: Date.now(),
        excludeSelectors: [] as string[],
        allowSameOriginFrames: false
      }
    }
  };

  const diagnostics: PageDiagnostics = {
    siteMode: 'low-density',
    annotatedWords: 8,
    scannedTextNodes: 42,
    pendingScan: false,
    lastScanAt: 100,
    lastScanDurationMs: 6,
    warnings: ['low-density']
  };

  it('lets users undo a global density reduction from 少标一点 without leaving low-density', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      ...lowDensityPolicies
    });
    const rescanPage = vi.fn().mockResolvedValue(undefined);

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store,
      openOptions: vi.fn(),
      rescanPage,
      getPageDiagnostics: vi.fn(async () => diagnostics)
    });

    root.querySelector<HTMLButtonElement>('[data-qianci-less-annotate]')?.click();
    await flushPopupWork();

    expect((await loadProfile(store))?.annotationDensity).toBe(0.9);
    expect(root.textContent).toContain('全局标注密度');
    const undoButton = root.querySelector<HTMLButtonElement>('[data-qianci-undo-density]');
    expect(undoButton).not.toBeNull();
    expect(undoButton?.textContent).toContain('撤销全局密度');

    undoButton?.click();
    await flushPopupWork();

    expect((await loadProfile(store))?.annotationDensity).toBe(1);
    expect(root.textContent).toContain('已撤销全局密度调整');
    expect(root.textContent).toContain('本站现在：少标模式');
    expect(rescanPage).toHaveBeenCalledTimes(2);
  });

  it('prevents repeated density changes while the first save is still pending', async () => {
    const root = document.createElement('div');
    const baseStore = createMemoryStore({
      'qianci.profile': createProfile('cet4'),
      ...lowDensityPolicies
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

    await mountPopupApp(root, {
      currentUrl: async () => 'https://www.example.com/article',
      store: slowStore,
      openOptions: vi.fn(),
      rescanPage: vi.fn(),
      getPageDiagnostics: vi.fn(async () => diagnostics)
    });

    const lessButton = root.querySelector<HTMLButtonElement>('[data-qianci-less-annotate]');
    lessButton?.click();
    lessButton?.click();
    await Promise.resolve();

    expect(setCalls).toBe(1);
    expect(root.textContent).toContain('正在调整标注密度');
    expect(root.querySelector('.diagnostics-panel')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector<HTMLButtonElement>('[data-qianci-rescan-page]')?.disabled).toBe(true);

    releaseSave();
    await flushPopupWork();

    expect((await loadProfile(baseStore))?.annotationDensity).toBe(0.9);
  });
});
