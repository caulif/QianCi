import type { SiteMode, SitePolicies } from './types';

export const DEFAULT_SITE_MODE: SiteMode = 'auto';

export function normalizeSiteKey(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.trim().toLowerCase();
    if (!hostname) {
      return undefined;
    }
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return undefined;
  }
}

export function getSiteModeForUrl(policies: SitePolicies, url: string): SiteMode {
  const siteKey = normalizeSiteKey(url);
  if (!siteKey) {
    return DEFAULT_SITE_MODE;
  }

  return policies[siteKey]?.mode ?? DEFAULT_SITE_MODE;
}

export function upsertSitePolicy(
  policies: SitePolicies,
  url: string,
  mode: SiteMode,
  updatedAt: number
): SitePolicies {
  const siteKey = normalizeSiteKey(url);
  if (!siteKey) {
    return policies;
  }

  if (mode === DEFAULT_SITE_MODE) {
    const { [siteKey]: _removed, ...rest } = policies;
    return rest;
  }

  return {
    ...policies,
    [siteKey]: {
      mode,
      updatedAt
    }
  };
}

export function isSiteMode(value: unknown): value is SiteMode {
  return value === 'auto' || value === 'manual-only' || value === 'paused';
}
