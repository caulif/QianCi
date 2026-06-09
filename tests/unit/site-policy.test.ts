import { describe, expect, it } from 'vitest';
import { getSiteModeForUrl, normalizeSiteKey, upsertSitePolicy } from '../../src/core/sitePolicy';
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
});

describe('site policy store', () => {
  it('persists policies independently from profile data and drops damaged entries', async () => {
    const store = createMemoryStore({
      'qianci.profile': { level: 'cet4' },
      'qianci.sitePolicies': {
        'example.com': { mode: 'paused', updatedAt: 100 },
        'bad.example': { mode: 'broken', updatedAt: 'bad' }
      }
    });

    const loaded = await loadSitePolicies(store);
    expect(loaded).toEqual({
      'example.com': { mode: 'paused', updatedAt: 100 }
    });

    await saveSitePolicies(store, upsertSitePolicy(loaded, 'https://docs.example.com', 'manual-only', 200));
    const saved = await loadSitePolicies(store);

    expect(saved['example.com']?.mode).toBe('paused');
    expect(saved['docs.example.com']?.mode).toBe('manual-only');
  });
});
