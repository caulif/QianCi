import { shouldAnnotateWord } from '../core/decision';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import {
  applyKnownFeedback,
  applyLookupFeedback,
  applySkipFeedback,
  markWordAlwaysAnnotate,
  underlineToneColor
} from '../core/profile';
import type { LookupFeedbackMode } from '../core/types';
import { buildPageDiagnostics } from './appDiagnostics';
import {
  ensureStyles,
  isUsableAnchor,
  matchesManualShortcut,
  onlineLookupStatusMessage,
  readSkipDelayMs,
  selectionAnchor,
  stableAnchor
} from './appHelpers';
import { createAnnotatedFragment } from './annotator';
import type { ContentApp, ContentServices } from './contentAppTypes';
import {
  ariaReferenceTargetsFromMutation,
  hasActiveTextSelection,
  removeAnnotationsInRoot,
  removeAnnotationElement,
  shouldCleanAnnotatedRoot,
  shouldSkipTextNode,
  SKIP_SELECTOR,
  suppressPageClick
} from './domCompatibility';
import type { RectLike } from './placement';
import { normalizeSelectedWord } from './selection';
import {
  clearUserInteractionYield,
  createScanSchedulerState,
  interactionYieldDelayMs,
  markUserInteraction,
  prioritizeChildNodes,
  recordMutationBatch,
  scanPreparationDelayMs,
  shouldYieldForInteraction
} from './scanScheduler';
import { createTooltipController } from './tooltip';
import { containsQianciAnnotation, containsQianciOwnedNode, isQianciOwnedMutation } from './mutationCompatibility';

const RESCAN_DELAY_MS = 24;
const SCAN_SLICE_BUDGET_MS = 8;
const SCAN_CONTINUATION_DELAY_MS = 0;
const SHADOW_DISCOVERY_INTERVAL_MS = 250;
const SHADOW_DISCOVERY_MAX_ATTEMPTS = 20;

interface ShadowDiscoveryHost {
  host: HTMLElement;
  attempts: number;
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
  const shadowDiscoveryHosts: ShadowDiscoveryHost[] = [];
  const trackedShadowDiscoveryHosts = new WeakSet<HTMLElement>();
  const slotEventRoots: EventTarget[] = [];
  const scanScheduler = createScanSchedulerState();
  let observedRoots = new WeakSet<ParentNode>();
  let observedRootList: ParentNode[] = [];
  const nodeQueue: Node[] = [];
  let nodeQueueIndex = 0;
  let rescanTimer = 0;
  let scanContinuationTimer = 0;
  let shadowDiscoveryTimer = 0;
  let skipFeedbackTimer = 0;
  let observer: MutationObserver | null = null;
  let scannedTextNodes = 0;
  let lastScanAt = 0;
  let lastScanDurationMs = 0;
  let maxScanSliceDurationMs = 0;

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
        clearUserInteractionYield(scanScheduler);
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

      if (!isUsableAnchor(anchor)) {
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
          if (!isUsableAnchor(anchor)) {
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
      markUserInteraction(scanScheduler, performance.now());
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

    element.addEventListener('click', (event) => {
      markUserInteraction(scanScheduler, performance.now());
      if (profile.lookupTrigger !== 'click') {
        return;
      }

      if (hasActiveTextSelection(doc)) {
        return;
      }

      suppressPageClick(event);
      clearSkipCandidate(element);
      tooltip.cancelHide();
      void lookupWord(element, word, 'click');
    });

    element.addEventListener('keydown', (event) => {
      markUserInteraction(scanScheduler, performance.now());
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

    markUserInteraction(scanScheduler, performance.now());
    void lookupSelection(doc.getSelection()?.toString() ?? '', 'alt');
  }

  /**
   * Records passive user activity so automatic scanning can yield briefly.
   *
   * @returns Nothing.
   */
  function handleScanYieldInteraction(): void {
    markUserInteraction(scanScheduler, performance.now());
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

  function getDiagnostics() {
    return buildPageDiagnostics({
      doc,
      observedRootList,
      siteMode,
      pendingRootCount: pendingRoots.size,
      hasPendingScan: Boolean(rescanTimer) || hasActiveScanQueue(),
      scannedTextNodes,
      lastScanAt,
      lastScanDurationMs,
      maxScanSliceDurationMs,
      queuedScanNodes: Math.max(0, nodeQueue.length - nodeQueueIndex),
      deferredScanNodes: scanScheduler.deferredScanNodes,
      throttledMutationBatches: scanScheduler.throttledMutationBatches
    });
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

    rescanTimer = window.setTimeout(
      prepareScanQueue,
      scanPreparationDelayMs(scanScheduler, RESCAN_DELAY_MS, performance.now())
    );
  }

  /**
   * Schedules the next slice of queued text-node annotation work.
   *
   * @returns Nothing.
   */
  function scheduleScanContinuation(delayMs = SCAN_CONTINUATION_DELAY_MS): void {
    if (scanContinuationTimer || disposed) {
      return;
    }

    scanContinuationTimer = window.setTimeout(processScanQueue, delayMs);
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

    const now = performance.now();
    if (shouldYieldForInteraction(scanScheduler, now)) {
      scheduleScanContinuation(interactionYieldDelayMs(scanScheduler, now));
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

        const nextNodes: Node[] = [];
        if (node instanceof HTMLElement && node.shadowRoot) {
          observeRoot(node.shadowRoot);
          nextNodes.push(node.shadowRoot);
        } else if (node instanceof HTMLElement) {
          trackShadowDiscoveryHost(node);
        }

        const prioritized = prioritizeChildNodes(Array.from(node.childNodes), doc);
        scanScheduler.deferredScanNodes += prioritized.deferredCount;
        nextNodes.push(...prioritized.nodes);
        nodeQueue.splice(nodeQueueIndex, 0, ...nextNodes);
      }

      if (performance.now() - startedAt >= SCAN_SLICE_BUDGET_MS) {
        lastScanAt = Date.now();
        lastScanDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
        maxScanSliceDurationMs = Math.max(maxScanSliceDurationMs, lastScanDurationMs);
        scheduleScanContinuation();
        return;
      }
    }

    lastScanAt = Date.now();
    lastScanDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    maxScanSliceDurationMs = Math.max(maxScanSliceDurationMs, lastScanDurationMs);
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
      attributes: true,
      attributeOldValue: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    observedRoots.add(root);
    observedRootList.push(root);
    if (root instanceof ShadowRoot) {
      root.addEventListener('slotchange', handleSlotChange, true);
      slotEventRoots.push(root);
    }
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
   * Tracks custom-element hosts that may attach an open shadow root after the first scan.
   *
   * @param element Element visited by the scanner.
   * @returns Nothing.
   */
  function trackShadowDiscoveryHost(element: HTMLElement): void {
    if (!element.localName.includes('-') || trackedShadowDiscoveryHosts.has(element)) {
      return;
    }

    trackedShadowDiscoveryHosts.add(element);
    shadowDiscoveryHosts.push({ host: element, attempts: 0 });
    scheduleShadowDiscovery();
  }

  /**
   * Schedules bounded low-frequency discovery for late open shadow roots.
   *
   * @returns Nothing.
   */
  function scheduleShadowDiscovery(): void {
    if (shadowDiscoveryTimer || disposed || siteMode !== 'auto' || !shadowDiscoveryHosts.length) {
      return;
    }

    shadowDiscoveryTimer = window.setTimeout(runShadowDiscovery, SHADOW_DISCOVERY_INTERVAL_MS);
  }

  /**
   * Finds late attached open shadow roots without continuously rescanning the page.
   *
   * @returns Nothing.
   */
  function runShadowDiscovery(): void {
    shadowDiscoveryTimer = 0;
    if (disposed || siteMode !== 'auto') {
      shadowDiscoveryHosts.length = 0;
      return;
    }

    const pendingHosts = shadowDiscoveryHosts.splice(0);
    for (const entry of pendingHosts) {
      if (!entry.host.isConnected) {
        continue;
      }
      if (entry.host.shadowRoot) {
        observeRoot(entry.host.shadowRoot);
        scheduleScan(entry.host.shadowRoot);
        continue;
      }
      if (entry.attempts + 1 < SHADOW_DISCOVERY_MAX_ATTEMPTS) {
        shadowDiscoveryHosts.push({ host: entry.host, attempts: entry.attempts + 1 });
      }
    }

    scheduleShadowDiscovery();
  }

  /**
   * Clears pending late-shadow discovery work for pause or disposal.
   *
   * @returns Nothing.
   */
  function clearShadowDiscovery(): void {
    shadowDiscoveryHosts.length = 0;
    if (shadowDiscoveryTimer) {
      window.clearTimeout(shadowDiscoveryTimer);
      shadowDiscoveryTimer = 0;
    }
  }

  /**
   * Handles native popover top-layer state changes that do not mutate attributes.
   *
   * @param event Toggle event dispatched by a native popover element.
   * @returns Nothing.
   */
  function handlePopoverToggle(event: Event): void {
    if (disposed || siteMode !== 'auto') {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute('popover')) {
      return;
    }

    if (shouldCleanAnnotatedRoot(target)) {
      removeAnnotationsInRoot(target);
      return;
    }

    scheduleScan(target);
  }

  /**
   * Handles slot distribution changes that do not mutate fallback text itself.
   *
   * @param event Slot change event dispatched from an observed shadow root.
   * @returns Nothing.
   */
  function handleSlotChange(event: Event): void {
    if (disposed || siteMode !== 'auto') {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLSlotElement)) {
      return;
    }

    if (target.assignedNodes().length > 0) {
      removeAnnotationsInRoot(target);
      return;
    }

    scheduleScan(target);
  }

  /**
   * Removes slotchange listeners from observed shadow roots.
   *
   * @returns Nothing.
   */
  function clearSlotEventRoots(): void {
    for (const root of slotEventRoots) {
      root.removeEventListener('slotchange', handleSlotChange, true);
    }
    slotEventRoots.length = 0;
  }

  doc.addEventListener('mouseup', handleManualSelection);
  doc.addEventListener('scroll', handleScanYieldInteraction, true);
  doc.addEventListener('selectionchange', handleScanYieldInteraction);
  observer = new MutationObserver((mutations) => {
    if (disposed) {
      return;
    }

    const pageMutationCount = mutations.filter((mutation) => {
      if (isQianciOwnedMutation(mutation)) {
        return false;
      }

      if (mutation.type !== 'childList') {
        return true;
      }

      return (
        !containsQianciOwnedNode(Array.from(mutation.addedNodes)) &&
        !containsQianciOwnedNode(Array.from(mutation.removedNodes))
      );
    }).length;
    if (pageMutationCount > 0) {
      recordMutationBatch(scanScheduler, pageMutationCount, performance.now());
    }

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target instanceof HTMLElement) {
          if (shouldCleanAnnotatedRoot(target)) {
            removeAnnotationsInRoot(target);
          } else {
            scheduleScan(target);
          }

          for (const referenceTarget of ariaReferenceTargetsFromMutation(target, mutation.attributeName, mutation.oldValue)) {
            if (shouldCleanAnnotatedRoot(referenceTarget)) {
              removeAnnotationsInRoot(referenceTarget);
            } else {
              scheduleScan(referenceTarget);
            }
          }

          const controlledIds = (target.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean);
          for (const controlledId of controlledIds) {
            const controlledElement = doc.getElementById(controlledId);
            if (!controlledElement) {
              continue;
            }

            if (target.getAttribute('aria-expanded') === 'false') {
              removeAnnotationsInRoot(controlledElement);
            } else if (target.getAttribute('role') === 'tab' && target.getAttribute('aria-selected') === 'false') {
              removeAnnotationsInRoot(controlledElement);
            } else {
              scheduleScan(controlledElement);
            }
          }
        }
        if ((target instanceof HTMLDetailsElement || target instanceof HTMLDialogElement) && target.open) {
          scheduleScan(target);
        }
        continue;
      }

      if (mutation.type === 'characterData') {
        const parent = mutation.target.parentNode;
        if (parent instanceof HTMLElement && !parent.closest(SKIP_SELECTOR)) {
          scheduleScan(parent);
        }
        continue;
      }

      const removedNodes = Array.from(mutation.removedNodes);
      if (containsQianciAnnotation(removedNodes, { includeSelf: false })) {
        tooltip.hide();
      }

      const addedNodes = Array.from(mutation.addedNodes);
      if (containsQianciAnnotation(addedNodes)) {
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
  doc.addEventListener('toggle', handlePopoverToggle, true);
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
    clearShadowDiscovery();
    clearSlotEventRoots();
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
      maxScanSliceDurationMs = 0;
      clearUserInteractionYield(scanScheduler);
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
        clearUserInteractionYield(scanScheduler);
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
      doc.removeEventListener('scroll', handleScanYieldInteraction, true);
      doc.removeEventListener('selectionchange', handleScanYieldInteraction);
      doc.removeEventListener('toggle', handlePopoverToggle, true);
      skipCandidates.clear();
      if (skipFeedbackTimer) {
        window.clearTimeout(skipFeedbackTimer);
        skipFeedbackTimer = 0;
      }
      clearScanWork();
      clearShadowDiscovery();
      clearSlotEventRoots();
      observer?.disconnect();
      observer = null;
      tooltip.dispose();
    }
  };
}
