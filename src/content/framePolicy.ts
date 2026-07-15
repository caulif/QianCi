export interface ContentFrameLike {
  self: unknown;
  top: unknown;
  location?: { href?: string; origin?: string };
}

export interface FrameBootstrapOptions {
  /** 站点策略允许同源 iframe 时为 true。 */
  allowSameOriginFrames?: boolean;
}

/**
 * Checks whether the content app should bootstrap in the current frame.
 *
 * Default: top-frame only. When allowSameOriginFrames is enabled, same-origin
 * child frames may start; cross-origin frames always exit safely.
 *
 * @param frame Browser frame-like object exposing self and top references.
 * @param options Optional frame opt-in flags from site policy.
 * @returns True when QianCi should start the content app for this frame.
 */
export function shouldBootstrapContentFrame(
  frame: ContentFrameLike,
  options: FrameBootstrapOptions = {}
): boolean {
  if (frame.self === frame.top) {
    return true;
  }

  if (!options.allowSameOriginFrames) {
    return false;
  }

  try {
    const topWindow = frame.top as { location?: { href?: string } } | null;
    // 跨域访问 top.location 会抛错，视为不可注入。
    void topWindow?.location?.href;
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析用于站点策略的 URL：优先顶层页面，跨域时退回当前 frame。
 */
export function resolvePolicyUrl(frame: ContentFrameLike): string {
  try {
    const topWindow = frame.top as { location?: { href?: string } } | null;
    if (topWindow?.location?.href) {
      return topWindow.location.href;
    }
  } catch {
    // 跨域
  }
  return frame.location?.href ?? 'https://invalid.local/';
}
