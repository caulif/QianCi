import type { SiteMode, SitePolicies, SitePolicy } from './types';

export const DEFAULT_SITE_MODE: SiteMode = 'auto';

/** safe 模式下额外跳过的区域选择器（与全局 SKIP_SELECTOR 叠加）。 */
export const SAFE_MODE_EXTRA_SELECTORS = [
  'table',
  'form',
  'header',
  '[role="banner"]',
  '.sidebar',
  '.side-bar',
  '.menu',
  '.toolbar',
  '.breadcrumb',
  '.breadcrumbs'
] as const;

const MAX_EXCLUDE_SELECTORS = 20;
const MAX_EXCLUDE_SELECTOR_LENGTH = 120;

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

/**
 * 规范化用户填写的排除选择器列表，丢弃非法项并截断长度。
 *
 * @param selectors 原始选择器列表。
 * @returns 可安全用于 closest/querySelector 的选择器。
 */
export function normalizeExcludeSelectors(selectors: unknown): string[] {
  if (!Array.isArray(selectors)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectors) {
    if (typeof raw !== 'string') {
      continue;
    }
    const selector = raw.trim();
    if (!selector || selector.length > MAX_EXCLUDE_SELECTOR_LENGTH || seen.has(selector)) {
      continue;
    }
    if (!isUsableCssSelector(selector)) {
      continue;
    }
    seen.add(selector);
    normalized.push(selector);
    if (normalized.length >= MAX_EXCLUDE_SELECTORS) {
      break;
    }
  }
  return normalized;
}

/**
 * 校验选择器是否可被浏览器解析，避免抛出未捕获异常。
 *
 * @param selector CSS 选择器。
 * @returns 可用时 true。
 */
export function isUsableCssSelector(selector: string): boolean {
  if (typeof document === 'undefined') {
    // 非 DOM 环境（如部分单元测试）只做粗校验。
    return !/[;{}]/.test(selector);
  }

  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

export function getSitePolicyForUrl(policies: SitePolicies, url: string): SitePolicy | undefined {
  const siteKey = normalizeSiteKey(url);
  if (!siteKey) {
    return undefined;
  }
  return policies[siteKey];
}

export function getSiteModeForUrl(policies: SitePolicies, url: string): SiteMode {
  return getSitePolicyForUrl(policies, url)?.mode ?? DEFAULT_SITE_MODE;
}

export type SitePolicyPatch = Partial<
  Pick<SitePolicy, 'mode' | 'excludeSelectors' | 'allowSameOriginFrames'>
>;

/**
 * 写入或更新站点策略；切回默认 auto 且无附加配置时删除该站点条目。
 * 第三参数兼容旧写法：直接传 SiteMode 字符串，或传字段 patch。
 */
export function upsertSitePolicy(
  policies: SitePolicies,
  url: string,
  modeOrPatch: SiteMode | SitePolicyPatch,
  updatedAt: number
): SitePolicies {
  const siteKey = normalizeSiteKey(url);
  if (!siteKey) {
    return policies;
  }

  const patch: SitePolicyPatch = typeof modeOrPatch === 'string' ? { mode: modeOrPatch } : modeOrPatch;
  const previous = policies[siteKey];
  const nextMode = patch.mode ?? previous?.mode ?? DEFAULT_SITE_MODE;
  const excludeSelectors =
    patch.excludeSelectors !== undefined
      ? normalizeExcludeSelectors(patch.excludeSelectors)
      : previous?.excludeSelectors ?? [];
  const allowSameOriginFrames =
    patch.allowSameOriginFrames !== undefined
      ? Boolean(patch.allowSameOriginFrames)
      : Boolean(previous?.allowSameOriginFrames);

  const isDefault =
    nextMode === DEFAULT_SITE_MODE && excludeSelectors.length === 0 && !allowSameOriginFrames;

  if (isDefault) {
    const { [siteKey]: _removed, ...rest } = policies;
    return rest;
  }

  return {
    ...policies,
    [siteKey]: {
      mode: nextMode,
      excludeSelectors: excludeSelectors.length ? excludeSelectors : undefined,
      allowSameOriginFrames: allowSameOriginFrames || undefined,
      updatedAt
    }
  };
}

export function isSiteMode(value: unknown): value is SiteMode {
  return (
    value === 'auto' ||
    value === 'manual-only' ||
    value === 'paused' ||
    value === 'low-density' ||
    value === 'safe'
  );
}

/**
 * low-density 模式下用于决策的密度系数（再压低自动标注）。
 */
export const LOW_DENSITY_SITE_MULTIPLIER = 0.82;
