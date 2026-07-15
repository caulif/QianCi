import type { ManualShortcut, UserProfile } from '../core/types';
import type { OnlineLookupErrorKind } from '../core/messages';
import type { RectLike } from './placement';

const SKIP_FEEDBACK_DELAY_MS = 3500;

/**
 * Reads weak-skip delay from newer profiles while preserving old-profile defaults.
 *
 * @param currentProfile User profile that may not yet expose feedbackSettings in its type.
 * @returns Safe skip delay in milliseconds.
 */
export function readSkipDelayMs(currentProfile: UserProfile): number {
  const delayMs = currentProfile.feedbackSettings?.skipDelayMs;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    return SKIP_FEEDBACK_DELAY_MS;
  }
  return delayMs;
}

/**
 * Ensures the page has QianCi annotation styles using the selected underline tone.
 *
 * @param doc Document that owns the annotation style element.
 * @param underlineColor CSS color used for annotation and focus styling.
 * @returns Nothing.
 */
export function ensureStyles(doc: Document, underlineColor: string): void {
  let style = doc.querySelector<HTMLStyleElement>('[data-qianci-style]');
  if (!style) {
    style = doc.createElement('style');
    style.dataset.qianciStyle = 'true';
    doc.head.append(style);
  }

  style.textContent = `
    .qianci-word {
      border-bottom: 1px dashed ${underlineColor};
      cursor: help;
      text-decoration: none;
    }

    .qianci-word:focus-visible {
      outline: 2px solid ${underlineColor};
      outline-offset: 2px;
      border-radius: 2px;
    }
  `;
}

/**
 * Captures a stable tooltip anchor before the source element may be removed.
 *
 * @param anchor Tooltip anchor from the annotated word or virtual selection.
 * @returns Rect-like position safe to reuse after DOM mutation.
 */
export function stableAnchor(anchor: HTMLElement | RectLike): HTMLElement | RectLike {
  if (!('getBoundingClientRect' in anchor)) {
    return anchor;
  }

  const rect = anchor.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

/**
 * Checks whether a tooltip anchor can still be used after async work finishes.
 *
 * @param anchor Tooltip anchor from an annotated word or virtual selection.
 * @returns True when the anchor is still valid for displaying lookup results.
 */
export function isUsableAnchor(anchor: HTMLElement | RectLike): boolean {
  return !(anchor instanceof HTMLElement) || anchor.isConnected;
}

/**
 * Checks whether a mouse event matches the configured manual lookup shortcut.
 *
 * @param event Mouse event that may trigger manual lookup.
 * @param shortcut User-configured shortcut modifier.
 * @returns True when the event should trigger manual lookup.
 */
export function matchesManualShortcut(event: MouseEvent, shortcut: ManualShortcut): boolean {
  switch (shortcut) {
    case 'ctrl':
      return event.ctrlKey;
    case 'shift':
      return event.shiftKey;
    case 'meta':
      return event.metaKey;
    case 'alt':
    default:
      return event.altKey;
  }
}

/**
 * Resolves a tooltip anchor for manual text selection lookup.
 *
 * @param doc Document that owns the active selection.
 * @param fallback Optional fallback element when the selection has no geometry.
 * @returns Rect-like selection position or fallback element.
 */
export function selectionAnchor(doc: Document, fallback?: HTMLElement): HTMLElement | RectLike {
  const selection = doc.getSelection();
  if (selection?.rangeCount) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      };
    }
  }

  return fallback ?? doc.body;
}

/**
 * Converts online lookup results into user-facing tooltip status text.
 *
 * @param result Online lookup response metadata.
 * @returns Message suitable for the missing-entry tooltip.
 */
export function onlineLookupStatusMessage(result: {
  message: string;
  errorKind?: OnlineLookupErrorKind;
  queued?: boolean;
}): string {
  const fallbackMessages: Record<OnlineLookupErrorKind, string> = {
    not_found: '暂时没有找到词条',
    rate_limited: '在线词典请求过于频繁，请稍后再试',
    service_unavailable: '在线词典暂时不可用，请稍后再试',
    network_error: '网络异常，稍后可重试',
    timeout: '联网查询超时，稍后可重试',
    parse_error: '在线词典返回内容异常，请稍后再试'
  };
  const baseMessage =
    result.message && result.message !== '联网查询失败'
      ? result.message
      : result.errorKind
        ? fallbackMessages[result.errorKind]
        : '联网查询失败';
  if (!result.queued) {
    return baseMessage;
  }

  return `${baseMessage}，已加入重试，可稍后在弹窗查看`;
}
