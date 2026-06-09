import { shouldAnnotateWord } from '../core/decision';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { OnlineLookupErrorKind, PageDiagnostics } from '../core/messages';
import {
  applyKnownFeedback,
  applyLookupFeedback,
  applySkipFeedback,
  markWordAlwaysAnnotate,
  underlineToneColor
} from '../core/profile';
import type { LookupFeedbackMode, LookupTrigger, ManualShortcut, SiteMode, UserProfile } from '../core/types';
import { createAnnotatedFragment } from './annotator';
import type { RectLike } from './placement';
import { normalizeSelectedWord } from './selection';
import { createTooltipController } from './tooltip';

export interface ContentServices {
  profile: UserProfile;
  ranks: Record<string, number>;
  resolveEntry(word: string): Promise<DictionaryEntry | undefined>;
  lookupOnline(word: string): Promise<{
    entry?: DictionaryEntry;
    message: string;
    errorKind?: OnlineLookupErrorKind;
    queued?: boolean;
  }>;
  siteMode?: SiteMode;
  onKnown(word: string, profile: UserProfile): void | Promise<void>;
  onUndoKnown?(word: string, profile: UserProfile, entry?: DictionaryEntry): void | Promise<void>;
  onLookup(word: string, mode: LookupFeedbackMode, profile: UserProfile, entry?: DictionaryEntry): void | Promise<void>;
  onSkip(word: string, pageKey: string, profile: UserProfile): void | Promise<void>;
  onAlwaysAnnotate?(word: string, profile: UserProfile): void | Promise<void>;
  onUndoAlwaysAnnotate?(word: string, profile: UserProfile): void | Promise<void>;
  onTranslationFeedback?(word: string, entry: DictionaryEntry): void | Promise<void>;
}

export interface ContentApp {
  rescan(): void;
  updateProfile(profile: UserProfile): void;
  updateSiteMode(mode: SiteMode): void;
  getDiagnostics(): PageDiagnostics;
  lookupSelection(selectionText: string, source?: 'alt' | 'menu'): Promise<void>;
  dispose(): void;
}

const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'input',
  'select',
  'button',
  'code',
  'pre',
  '[contenteditable="true"]',
  '[data-qianci-tooltip]',
  '[data-qianci-word]'
].join(',');

const RESCAN_DELAY_MS = 24;
const SKIP_FEEDBACK_DELAY_MS = 3500;
const SCAN_SLICE_BUDGET_MS = 8;
const SCAN_CONTINUATION_DELAY_MS = 0;

/**
 * Reads weak-skip delay from newer profiles while preserving old-profile defaults.
 *
 * @param currentProfile User profile that may not yet expose feedbackSettings in its type.
 * @returns Safe skip delay in milliseconds.
 */
function readSkipDelayMs(currentProfile: UserProfile): number {
  const delayMs = currentProfile.feedbackSettings?.skipDelayMs;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    return SKIP_FEEDBACK_DELAY_MS;
  }
  return delayMs;
}

function ensureStyles(doc: Document, underlineColor: string): void {
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

function shouldSkipTextNode(text: Text): boolean {
  const parent = text.parentElement;
  if (!parent) {
    return true;
  }
  return Boolean(parent.closest(SKIP_SELECTOR));
}

function removeAnnotationElement(element: HTMLElement): void {
  const text = element.ownerDocument.createTextNode(element.textContent ?? '');
  element.replaceWith(text);
}

/**
 * Captures a stable tooltip anchor before the source element may be removed.
 *
 * @param anchor Tooltip anchor from the annotated word or virtual selection.
 * @returns Rect-like position safe to reuse after DOM mutation.
 */
function stableAnchor(anchor: HTMLElement | RectLike): HTMLElement | RectLike {
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

function matchesManualShortcut(event: MouseEvent, shortcut: ManualShortcut): boolean {
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

function selectionAnchor(doc: Document, fallback?: HTMLElement): HTMLElement | RectLike {
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

export function createContentApp(doc: Document, services: ContentServices): ContentApp {
  let disposed = false;
  let profile = services.profile;
  let siteMode = services.siteMode ?? 'auto';
  const tooltip = createTooltipController(doc);
  tooltip.updateFocusColor(underlineToneColor(profile.underlineTone));
  const skipCandidates = new Map<HTMLElement, { word: string; observedAt: number; pageKey: string }>();
  const interactedWords = new WeakSet<HTMLElement>();
  const pendingRoots = new Set<ParentNode>();
  let observedRoots = new WeakSet<ParentNode>();
  let observedRootList: ParentNode[] = [];
  const nodeQueue: Node[] = [];
  let nodeQueueIndex = 0;
  let rescanTimer = 0;
  let scanContinuationTimer = 0;
  let skipFeedbackTimer = 0;
  let observer: MutationObserver | null = null;
  let scannedTextNodes = 0;
  let lastScanAt = 0;
  let lastScanDurationMs = 0;

  function pageKey(): string {
    return doc.location?.href || 'document';
  }

  function isElementVisible(element: HTMLElement): boolean {
    const view = doc.defaultView ?? window;
    const rect = element.getBoundingClientRect();
    return rect.top <= view.innerHeight && rect.bottom >= 0;
  }

  /**
   * 创建“认识”动作，移除当前标注并保留一次短期撤销入口。
   *
   * @param anchor 触发动作的标注词或虚拟位置。
   * @param word 被标记为已认识的单词。
   * @param entry 当前卡片展示的词条，用于撤销后恢复生词本。
   * @returns tooltip 按钮点击处理函数。
   */
  function knownAction(anchor: HTMLElement | RectLike, word: string, entry?: DictionaryEntry): () => void {
    return () => {
      const previousProfile = profile;
      const noticeAnchor = stableAnchor(anchor);
      profile = applyKnownFeedback(profile, word, Date.now());
      void services.onKnown(word, profile);
      if (anchor instanceof HTMLElement && anchor.dataset.qianciWord) {
        removeAnnotationElement(anchor);
      }
      tooltip.showKnownNotice(noticeAnchor, word, () => {
        profile = previousProfile;
        void services.onUndoKnown?.(word, profile, entry);
        tooltip.hide();
        scheduleScan(doc.body);
      });
    };
  }

  /**
   * 创建“继续提醒”动作，让弱反馈不再自动隐藏该词。
   *
   * @param word 用户希望继续看到标注的单词。
   * @returns tooltip 按钮点击处理函数。
   */
  function alwaysAnnotateAction(anchor: HTMLElement | RectLike, word: string): () => void {
    return () => {
      const previousProfile = profile;
      const noticeAnchor = stableAnchor(anchor);
      profile = markWordAlwaysAnnotate(profile, word, Date.now());
      void services.onAlwaysAnnotate?.(word, profile);
      tooltip.showAlwaysAnnotateNotice(noticeAnchor, word, () => {
        profile = previousProfile;
        void services.onUndoAlwaysAnnotate?.(word, profile);
        tooltip.hide();
      });
    };
  }

  /**
   * 创建“释义不准”反馈动作，保持 tooltip 只负责轻量确认。
   *
   * @param word 用户反馈的单词。
   * @param entry 当前展示的词条。
   * @returns tooltip 反馈按钮点击处理函数。
   */
  function translationFeedbackAction(word: string, entry: DictionaryEntry): (feedbackWord: string) => void {
    return (feedbackWord: string) => {
      void services.onTranslationFeedback?.(feedbackWord || word, entry);
    };
  }

  function clearSkipCandidate(element: HTMLElement): void {
    interactedWords.add(element);
    skipCandidates.delete(element);
  }

  function flushSkipFeedback(): void {
    skipFeedbackTimer = 0;
    if (disposed) {
      skipCandidates.clear();
      return;
    }

    const now = Date.now();
    const skipDelayMs = readSkipDelayMs(profile);
    let nextDelay = Number.POSITIVE_INFINITY;
    for (const [element, candidate] of Array.from(skipCandidates)) {
      if (!element.isConnected || interactedWords.has(element)) {
        skipCandidates.delete(element);
        continue;
      }

      const elapsed = now - candidate.observedAt;
      if (elapsed < skipDelayMs) {
        nextDelay = Math.min(nextDelay, skipDelayMs - elapsed);
        continue;
      }

      skipCandidates.delete(element);
      if (isElementVisible(element)) {
        profile = applySkipFeedback(profile, candidate.word, candidate.pageKey, now);
        void services.onSkip(candidate.word, candidate.pageKey, profile);
      }
    }

    if (Number.isFinite(nextDelay)) {
      skipFeedbackTimer = window.setTimeout(flushSkipFeedback, nextDelay);
    }
  }

  function scheduleSkipFeedback(element: HTMLElement, word: string): void {
    skipCandidates.set(element, { word, observedAt: Date.now(), pageKey: pageKey() });
    if (!skipFeedbackTimer) {
      skipFeedbackTimer = window.setTimeout(flushSkipFeedback, readSkipDelayMs(profile));
    }
  }

  interface LookupWordOptions {
    focusPrimaryAction?: boolean;
    returnFocusTo?: HTMLElement;
  }

  /**
   * 将联网补查结果转换成用户能理解的 tooltip 状态文案。
   *
   * @param result 联网补查返回值。
   * @returns 适合显示在缺词卡片里的提示。
   */
  function onlineLookupStatusMessage(result: {
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

    return `${baseMessage}。已加入重试队列，稍后自动重试。`;
  }

  async function showOnlineResult(
    anchor: HTMLElement | RectLike,
    word: string,
    entry: DictionaryEntry,
    mode: LookupFeedbackMode,
    options: LookupWordOptions = {}
  ): Promise<void> {
    profile = applyLookupFeedback(profile, word, mode, Date.now());
    void services.onLookup(word, mode, profile, entry);
    tooltip.showEntry(anchor, entry, knownAction(anchor, word, entry), alwaysAnnotateAction(anchor, word), {
      focusPrimaryAction: options.focusPrimaryAction,
      returnFocusTo: options.returnFocusTo,
      onTranslationFeedback: translationFeedbackAction(word, entry)
    });
  }

  async function lookupWord(
    anchor: HTMLElement | RectLike,
    word: string,
    mode: LookupFeedbackMode,
    options: LookupWordOptions = {}
  ): Promise<void> {
    try {
      const entry = await services.resolveEntry(word);
      if (disposed) {
        return;
      }

      if (entry) {
        profile = applyLookupFeedback(profile, word, mode, Date.now());
        void services.onLookup(word, mode, profile, entry);
        tooltip.showEntry(anchor, entry, knownAction(anchor, word, entry), alwaysAnnotateAction(anchor, word), {
          focusPrimaryAction: options.focusPrimaryAction,
          returnFocusTo: options.returnFocusTo,
          onTranslationFeedback: translationFeedbackAction(word, entry)
        });
        return;
      }

      tooltip.showMissing(anchor, word, async () => {
        let loadingVersion = 0;
        try {
          tooltip.showLoading(anchor, word, {
            focusPrimaryAction: options.focusPrimaryAction,
            returnFocusTo: options.returnFocusTo
          });
          loadingVersion = tooltip.version();
          const result = await services.lookupOnline(word);
          if (tooltip.version() !== loadingVersion) {
            return;
          }
          if (!result.entry) {
            tooltip.showMissing(anchor, word, async () => {
              await lookupWord(anchor, word, mode, options);
            }, onlineLookupStatusMessage(result), {
              focusPrimaryAction: options.focusPrimaryAction,
              returnFocusTo: options.returnFocusTo,
              announceStatus: true
            });
            return;
          }

          await showOnlineResult(anchor, word, result.entry, mode, options);
        } catch (error) {
          if (tooltip.version() !== loadingVersion) {
            return;
          }
          console.error(error);
          tooltip.showMissing(anchor, word, async () => {
            await lookupWord(anchor, word, mode, options);
          }, '联网查询失败', {
            focusPrimaryAction: options.focusPrimaryAction,
            returnFocusTo: options.returnFocusTo,
            announceStatus: true
          });
        }
      }, '词库里没有', {
        focusPrimaryAction: options.focusPrimaryAction,
        returnFocusTo: options.returnFocusTo
      });
    } catch (error) {
      console.error(error);
    }
  }

  function bindWordElement(element: HTMLElement): void {
    const word = element.dataset.qianciWord;
    if (!word) {
      return;
    }
    let hoverRequestId = 0;

    scheduleSkipFeedback(element, word);

    element.addEventListener('mouseenter', () => {
      if (profile.lookupTrigger !== 'hover') {
        return;
      }

      clearSkipCandidate(element);
      tooltip.cancelHide();
      const requestId = hoverRequestId + 1;
      hoverRequestId = requestId;

      void (async () => {
        try {
          const entry = await services.resolveEntry(word);
          if (!entry || hoverRequestId !== requestId || disposed || !element.isConnected) {
            return;
          }

          profile = applyLookupFeedback(profile, word, 'hover', Date.now());
          void services.onLookup(word, 'hover', profile, entry);
          tooltip.showEntry(element, entry, knownAction(element, word, entry), alwaysAnnotateAction(element, word), {
            onTranslationFeedback: translationFeedbackAction(word, entry)
          });
        } catch (error) {
          console.error(error);
        }
      })();
    });

    element.addEventListener('mouseleave', () => {
      hoverRequestId += 1;
      tooltip.scheduleHide();
    });

    element.addEventListener('click', () => {
      if (profile.lookupTrigger !== 'click') {
        return;
      }

      clearSkipCandidate(element);
      tooltip.cancelHide();
      void lookupWord(element, word, 'click');
    });

    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      clearSkipCandidate(element);
      tooltip.cancelHide();
      void lookupWord(element, word, 'click', { focusPrimaryAction: true, returnFocusTo: element });
    });
  }

  async function lookupSelection(selectionText: string, source: 'alt' | 'menu' = 'alt'): Promise<void> {
    const selectedWord = normalizeSelectedWord(selectionText);
    if (!selectedWord) {
      return;
    }

    const anchor = selectionAnchor(doc);
    await lookupWord(anchor, selectedWord, 'selection');
  }

  function handleManualSelection(event: MouseEvent): void {
    if (siteMode === 'paused') {
      return;
    }

    if (!matchesManualShortcut(event, profile.manualShortcut)) {
      return;
    }

    void lookupSelection(doc.getSelection()?.toString() ?? '', 'alt');
  }

  function annotateTextNode(textNode: Text): void {
    const fragment = createAnnotatedFragment(textNode.data, (token) => {
      const rank = services.ranks[token.normalized];
      if (!rank) {
        return false;
      }
      return shouldAnnotateWord(profile, { word: token.normalized, rank });
    });

    const annotated = Array.from(fragment.querySelectorAll<HTMLElement>('[data-qianci-word]'));
    if (!annotated.length) {
      return;
    }

    for (const element of annotated) {
      bindWordElement(element);
    }
    textNode.replaceWith(fragment);
  }

  function annotatedWordCount(): number {
    const annotatedWords = new Set<HTMLElement>();
    for (const root of [doc, ...observedRootList]) {
      for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-qianci-word]'))) {
        annotatedWords.add(element);
      }
    }
    return annotatedWords.size;
  }

  function diagnosticsWarnings(): PageDiagnostics['warnings'] {
    const warnings: PageDiagnostics['warnings'] = [];
    if (siteMode === 'paused') {
      warnings.push('paused');
    }

    if (siteMode === 'manual-only') {
      warnings.push('manual-only');
    }

    if (pendingRoots.size > 10) {
      warnings.push('dynamic-page');
    }

    if (doc.querySelector('[contenteditable="true"], [role="textbox"], .monaco-editor, .cm-editor, .CodeMirror')) {
      warnings.push('editor-detected');
    }

    const editableFields = doc.querySelectorAll(
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"]'
    );
    if (editableFields.length >= 2) {
      warnings.push('form-heavy');
    }

    if (doc.querySelectorAll('pre').length >= 2) {
      warnings.push('code-heavy');
    }

    return warnings;
  }

  function getDiagnostics(): PageDiagnostics {
    return {
      siteMode,
      annotatedWords: annotatedWordCount(),
      scannedTextNodes,
      pendingScan: Boolean(rescanTimer) || hasActiveScanQueue(),
      lastScanAt,
      lastScanDurationMs,
      warnings: diagnosticsWarnings()
    };
  }

  /**
   * Returns whether a queued root can still be scanned safely.
   *
   * @param root Root node collected from rescan or mutation observer.
   * @returns True when the root is still attached or does not expose connection state.
   */
  function isConnectedRoot(root: ParentNode): boolean {
    return root instanceof Node && 'isConnected' in root ? root.isConnected : true;
  }

  /**
   * Adds a root while dropping redundant parent-child duplicates.
   *
   * @param root Root node whose text descendants should be scanned.
   * @returns Nothing.
   */
  function addPendingRoot(root: ParentNode): void {
    if (!(root instanceof Node)) {
      pendingRoots.add(root);
      return;
    }

    for (const existingRoot of Array.from(pendingRoots)) {
      if (!(existingRoot instanceof Node)) {
        continue;
      }

      if (existingRoot === root || existingRoot.contains(root)) {
        return;
      }

      if (root.contains(existingRoot)) {
        pendingRoots.delete(existingRoot);
      }
    }

    pendingRoots.add(root);
  }

  /**
   * Clears queued scan work and any timers that would continue it.
   *
   * @returns Nothing.
   */
  function clearScanWork(): void {
    if (rescanTimer) {
      window.clearTimeout(rescanTimer);
      rescanTimer = 0;
    }

    if (scanContinuationTimer) {
      window.clearTimeout(scanContinuationTimer);
      scanContinuationTimer = 0;
    }

    pendingRoots.clear();
    nodeQueue.length = 0;
    nodeQueueIndex = 0;
  }

  /**
   * Checks whether collected text nodes are still being processed.
   *
   * @returns True when scan continuation work is active or queued.
   */
  function hasActiveScanQueue(): boolean {
    return Boolean(scanContinuationTimer) || nodeQueueIndex < nodeQueue.length;
  }

  /**
   * Starts collecting text nodes after batched root mutations settle.
   *
   * @returns Nothing.
   */
  function scheduleScanPreparation(): void {
    if (rescanTimer || disposed || hasActiveScanQueue()) {
      return;
    }

    rescanTimer = window.setTimeout(prepareScanQueue, RESCAN_DELAY_MS);
  }

  /**
   * Schedules the next slice of queued text-node annotation work.
   *
   * @returns Nothing.
   */
  function scheduleScanContinuation(): void {
    if (scanContinuationTimer || disposed) {
      return;
    }

    scanContinuationTimer = window.setTimeout(processScanQueue, SCAN_CONTINUATION_DELAY_MS);
  }

  /**
   * Seeds deduplicated roots before chunked DOM traversal and annotation.
   *
   * @returns Nothing.
   */
  function prepareScanQueue(): void {
    rescanTimer = 0;
    if (disposed) {
      clearScanWork();
      return;
    }

    ensureStyles(doc, underlineToneColor(profile.underlineTone));
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const pendingRoot of roots) {
      if (isConnectedRoot(pendingRoot)) {
        nodeQueue.push(pendingRoot as Node);
      }
    }

    if (nodeQueueIndex < nodeQueue.length) {
      scheduleScanContinuation();
      return;
    }

    observeBody();
  }

  /**
   * Walks and annotates queued DOM nodes in small slices to reduce main-thread blocking.
   *
   * @returns Nothing.
   */
  function processScanQueue(): void {
    scanContinuationTimer = 0;
    if (disposed) {
      clearScanWork();
      return;
    }

    const startedAt = performance.now();
    while (nodeQueueIndex < nodeQueue.length) {
      const node = nodeQueue[nodeQueueIndex];
      nodeQueueIndex += 1;

      if (!node.isConnected) {
        continue;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const textNode = node as Text;
        if (textNode.data.trim() && !shouldSkipTextNode(textNode)) {
          scannedTextNodes += 1;
          annotateTextNode(textNode);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(SKIP_SELECTOR)) {
          continue;
        }

        if (node instanceof HTMLElement && node.shadowRoot) {
          observeRoot(node.shadowRoot);
          nodeQueue.push(node.shadowRoot);
        }

        nodeQueue.push(...Array.from(node.childNodes));
      }

      if (performance.now() - startedAt >= SCAN_SLICE_BUDGET_MS) {
        lastScanAt = Date.now();
        lastScanDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
        scheduleScanContinuation();
        return;
      }
    }

    lastScanAt = Date.now();
    lastScanDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    nodeQueue.length = 0;
    nodeQueueIndex = 0;
    if (pendingRoots.size) {
      scheduleScanPreparation();
      return;
    }

    observeBody();
  }

  function observeRoot(root: ParentNode): void {
    if (!observer || observedRoots.has(root)) {
      return;
    }

    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true
    });
    observedRoots.add(root);
    observedRootList.push(root);
  }

  function observeBody(): void {
    if (!doc.body) {
      return;
    }

    observeRoot(doc.body);
  }

  function scheduleScan(root: ParentNode = doc.body): void {
    if (!root || disposed || siteMode !== 'auto') {
      return;
    }

    addPendingRoot(root);
    scheduleScanPreparation();
  }

  /**
   * Detects mutations caused by QianCi's own annotation spans.
   *
   * @param nodes Added DOM nodes from a mutation record.
   * @returns True when this mutation should not trigger another page scan.
   */
  function containsOwnAnnotation(nodes: Node[]): boolean {
    return nodes.some((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }

      return Boolean(node.dataset.qianciWord) || Boolean(node.querySelector('[data-qianci-word]'));
    });
  }

  doc.addEventListener('mouseup', handleManualSelection);
  observer = new MutationObserver((mutations) => {
    if (disposed) {
      return;
    }

    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const parent = mutation.target.parentNode;
        if (parent instanceof HTMLElement && !parent.closest(SKIP_SELECTOR)) {
          scheduleScan(parent);
        }
        continue;
      }

      const addedNodes = Array.from(mutation.addedNodes);
      if (containsOwnAnnotation(addedNodes)) {
        continue;
      }

      for (const node of addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentNode;
          if (parent instanceof HTMLElement && !parent.closest(SKIP_SELECTOR)) {
            scheduleScan(parent);
          }
          continue;
        }

        if (node instanceof HTMLElement && !node.closest(SKIP_SELECTOR)) {
          scheduleScan(node);
        }
      }
    }
  });
  if (siteMode === 'auto') {
    observeBody();
  }

  function removeAllAnnotations(): void {
    const roots: ParentNode[] = [doc, ...observedRootList];
    const annotatedWords = roots.flatMap((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('[data-qianci-word]'))
    );
    for (const element of annotatedWords) {
      removeAnnotationElement(element);
    }
  }

  function pauseAutomaticAnnotation(): void {
    clearScanWork();
    observer?.disconnect();
    skipCandidates.clear();
    tooltip.hide();
    removeAllAnnotations();
    observedRoots = new WeakSet<ParentNode>();
    observedRootList = [];
  }

  return {
    rescan() {
      if (disposed || !doc.body) {
        return;
      }

      scannedTextNodes = 0;
      scheduleScan(doc.body);
    },
    updateProfile(nextProfile) {
      profile = nextProfile;
      ensureStyles(doc, underlineToneColor(profile.underlineTone));
      tooltip.updateFocusColor(underlineToneColor(profile.underlineTone));
    },
    updateSiteMode(mode) {
      if (siteMode === mode) {
        return;
      }

      siteMode = mode;
      if (siteMode === 'auto') {
        observeBody();
        scheduleScan(doc.body);
        return;
      }

      pauseAutomaticAnnotation();
    },
    getDiagnostics() {
      return getDiagnostics();
    },
    async lookupSelection(selectionText, source = 'alt') {
      await lookupSelection(selectionText, source);
    },
    dispose() {
      disposed = true;
      doc.removeEventListener('mouseup', handleManualSelection);
      skipCandidates.clear();
      if (skipFeedbackTimer) {
        window.clearTimeout(skipFeedbackTimer);
        skipFeedbackTimer = 0;
      }
      clearScanWork();
      observer?.disconnect();
      observer = null;
      tooltip.dispose();
    }
  };
}
