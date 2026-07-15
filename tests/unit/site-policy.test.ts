import { describe, expect, it } from 'vitest';
import {
  getSiteModeForUrl,
  getSitePolicyForUrl,
  isUsableCssSelector,
  normalizeExcludeSelectors,
  normalizeSiteKey,
  upsertSitePolicy
} from '../../src/core/sitePolicy';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { loadSitePolicies, saveSitePolicies } from '../../src/storage/sitePolicyStore';

describe('site policy helpers', () => {
  it('normalizes urls to stable host keys', () => {
    expect(normalizeSiteKey('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeSiteKey('http://docs.example.com:8080/page')).toBe('docs.example.com');
    expect(normalizeSiteKey('not a url')).toBeUndefined();
  });

  it('resolves explicit site modes and defaults to auto', () => {
    const policies = upsertSitePolicy({}, 'https://www.example.com/article', 'manual-only', 100);

    expect(getSiteModeForUrl(policies, 'https://example.com/next')).toBe('manual-only');
    expect(getSiteModeForUrl(policies, 'https://other.example/next')).toBe('auto');
  });

  it('stores low-density and safe modes with exclude selectors and frame opt-in', () => {
    let policies = upsertSitePolicy(
      {},
      'https://docs.example.com',
      {
        mode: 'safe',
        excludeSelectors: ['.toolbar', '#sidebar', ';;;invalid'],
        allowSameOriginFrames: true
      },
      200
    );

    const policy = getSitePolicyForUrl(policies, 'https://docs.example.com/page');
    expect(policy?.mode).toBe('safe');
    expect(policy?.excludeSelectors).toEqual(['.toolbar', '#sidebar']);
    expect(policy?.allowSameOriginFrames).toBe(true);

    policies = upsertSitePolicy(policies, 'https://docs.example.com', { mode: 'low-density' }, 300);
    expect(getSiteModeForUrl(policies, 'https://docs.example.com')).toBe('low-density');
    expect(getSitePolicyForUrl(policies, 'https://docs.example.com')?.excludeSelectors).toEqual([
      '.toolbar',
      '#sidebar'
    ]);
  });

  it('filters unusable exclude selectors', () => {
    expect(normalizeExcludeSelectors(['.ok', '', 'a'.repeat(200), 12, '.ok'])).toEqual(['.ok']);
    expect(isUsableCssSelector('.toolbar')).toBe(true);
  });
});

describe('site policy store', () => {
  it('persists policies independently from profile data and drops damaged entries', async () => {
    const store = createMemoryStore({
      'qianci.profile': { level: 'cet4' },
      'qianci.sitePolicies': {
        'example.com': {
          mode: 'paused',
          updatedAt: 100,
          excludeSelectors: ['.ads'],
          allowSameOriginFrames: true
        },
        'bad.example': { mode: 'broken', updatedAt: 'bad' }
      }
    });

    const loaded = await loadSitePolicies(store);
    expect(loaded).toEqual({
      'example.com': {
        mode: 'paused',
        updatedAt: 100,
        excludeSelectors: ['.ads'],
        allowSameOriginFrames: true
      }
    });

    await saveSitePolicies(store, upsertSitePolicy(loaded, 'https://docs.example.com', 'manual-only', 200));
    const saved = await loadSitePolicies(store);

    expect(saved['example.com']?.mode).toBe('paused');
    expect(saved['docs.example.com']?.mode).toBe('manual-only');
  });
});
