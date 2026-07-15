import { isSiteMode, normalizeExcludeSelectors } from '../core/sitePolicy';
import type { SitePolicies, SitePolicy } from '../core/types';
import type { KeyValueStore } from './browserAdapter';

export const SITE_POLICIES_KEY = 'qianci.sitePolicies';

function normalizeSitePolicy(value: unknown): SitePolicy | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const policy = value as Partial<SitePolicy>;
  if (!isSiteMode(policy.mode) || typeof policy.updatedAt !== 'number' || !Number.isFinite(policy.updatedAt)) {
    return undefined;
  }

  const excludeSelectors = normalizeExcludeSelectors(policy.excludeSelectors);
  return {
    mode: policy.mode,
    excludeSelectors: excludeSelectors.length ? excludeSelectors : undefined,
    allowSameOriginFrames: policy.allowSameOriginFrames === true ? true : undefined,
    updatedAt: policy.updatedAt
  };
}

export function normalizeSitePolicies(value: unknown): SitePolicies {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const policies: SitePolicies = {};
  for (const [siteKey, policyValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedPolicy = normalizeSitePolicy(policyValue);
    if (normalizedPolicy) {
      policies[siteKey] = normalizedPolicy;
    }
  }

  return policies;
}

export async function loadSitePolicies(store: KeyValueStore): Promise<SitePolicies> {
  const items = await store.get<{ [SITE_POLICIES_KEY]?: unknown }>([SITE_POLICIES_KEY]);
  return normalizeSitePolicies(items[SITE_POLICIES_KEY]);
}

export async function saveSitePolicies(store: KeyValueStore, policies: SitePolicies): Promise<void> {
  await store.set({ [SITE_POLICIES_KEY]: normalizeSitePolicies(policies) });
}
