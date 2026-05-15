import { shouldAnnotateWord } from '../core/decision';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import { applyKnownFeedback, applyLookupFeedback, applySkipFeedback, underlineToneColor } from '../core/profile';
import type { LookupFeedbackMode, LookupTrigger, ManualShortcut, UserProfile } from '../core/types';
import { createAnnotatedFragment } from './annotator';
import type { RectLike } from './placement';
import { normalizeSelectedWord } from './selection';
import { createTooltipController } from './tooltip';

export interface ContentServices {
  profile: UserProfile;
  ranks: Record<string, number>;
  resolveEntry(word: string): Promise<DictionaryEntry | undefined>;
  lookupOnline(word: string): Promise<{ entry?: DictionaryEntry; message: string }>;
  onKnown(word: string, profile: UserProfile): void | Promise<void>;
  onLookup(word: string, mode: LookupFeedbackMode, profile: UserProfile, entry?: DictionaryEntry): void | Promise<void>;
  onSkip(word: string, pageKey: string, profile: UserProfile): void | Promise<void>;
}

export interface ContentApp {
  rescan(): void;
  updateProfile(profile: UserProfile): void;
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
  `;
}

function shouldSkipTextNode(text: Text): boolean {
  const parent = text.parentElement;
  if (!parent) {
    return true;
  }
  return Boolean(parent.closest(SKIP_SELECTOR));
}

function collectTextNodes(root: ParentNode): Text[] {
  const nodes: Text[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      if (text.data.trim() && !shouldSkipTextNode(text)) {
        nodes.push(text);
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(SKIP_SELECTOR)) {
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  }

  walk(root as Node);
  return nodes;
}

function removeAnnotationElement(element: HTMLElement): void {
  const text = element.ownerDocument.createTextNode(element.textContent ?? '');
  element.replaceWith(text);
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
  const tooltip = createTooltipController(doc);
  const skipCandidates = new Map<HTMLElement, { word: string; observedAt: number; pageKey: string }>();
  const interactedWords = new WeakSet<HTMLElement>();
  const pendingRoots = new Set<ParentNode>();
  let rescanTimer = 0;
  let skipFeedbackTimer = 0;
  let observer: MutationObserver | null = null;

  function pageKey(): string {
    return doc.location?.href || 'document';
  }

  function isElementVisible(element: HTMLElement): boolean {
    const view = doc.defaultView ?? window;
    const rect = element.getBoundingClientRect();
    return rect.top <= view.innerHeight && rect.bottom >= 0;
  }

  function knownAction(anchor: HTMLElement | RectLike, word: string): () => void {
    return () => {
      profile = applyKnownFeedback(profile, word, Date.now());
      void services.onKnown(word, profile);
      tooltip.hide();
      if (anchor instanceof HTMLElement && anchor.dataset.qianciWord) {
        removeAnnotationElement(anchor);
      }
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
    let nextDelay = Number.POSITIVE_INFINITY;
    for (const [element, candidate] of Array.from(skipCandidates)) {
      if (!element.isConnected || interactedWords.has(element)) {
        skipCandidates.delete(element);
        continue;
      }

      const elapsed = now - candidate.observedAt;
      if (elapsed < SKIP_FEEDBACK_DELAY_MS) {
        nextDelay = Math.min(nextDelay, SKIP_FEEDBACK_DELAY_MS - elapsed);
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
      skipFeedbackTimer = window.setTimeout(flushSkipFeedback, SKIP_FEEDBACK_DELAY_MS);
    }
  }

  async function showOnlineResult(
    anchor: HTMLElement | RectLike,
    word: string,
    entry: DictionaryEntry,
    mode: LookupFeedbackMode
  ): Promise<void> {
    profile = applyLookupFeedback(profile, word, mode, Date.now());
    void services.onLookup(word, mode, profile, entry);
    tooltip.showEntry(anchor, entry, knownAction(anchor, word));
  }

  async function lookupWord(anchor: HTMLElement | RectLike, word: string, mode: LookupFeedbackMode): Promise<void> {
    try {
      const entry = await services.resolveEntry(word);
      if (disposed) {
        return;
      }

      if (entry) {
        profile = applyLookupFeedback(profile, word, mode, Date.now());
        void services.onLookup(word, mode, profile, entry);
        tooltip.showEntry(anchor, entry, knownAction(anchor, word));
        return;
      }

      tooltip.showMissing(anchor, word, async () => {
        try {
          tooltip.showLoading(anchor, word);
          const result = await services.lookupOnline(word);
          if (!result.entry) {
            tooltip.showMissing(anchor, word, async () => {
              await lookupWord(anchor, word, mode);
            }, result.message);
            return;
          }

          await showOnlineResult(anchor, word, result.entry, mode);
        } catch (error) {
          console.error(error);
          tooltip.showMissing(anchor, word, async () => {
            await lookupWord(anchor, word, mode);
          }, '联网查询失败');
        }
      }, '词库里没有');
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
          tooltip.showEntry(element, entry, knownAction(element, word));
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

  function scanRoot(root: ParentNode): void {
    for (const textNode of collectTextNodes(root)) {
      annotateTextNode(textNode);
    }
  }

  function observeBody(): void {
    if (!observer || !doc.body) {
      return;
    }

    observer.observe(doc.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function scheduleScan(root: ParentNode = doc.body): void {
    if (!root || disposed) {
      return;
    }

    pendingRoots.add(root);
    if (rescanTimer) {
      return;
    }

    rescanTimer = window.setTimeout(() => {
      rescanTimer = 0;
      if (disposed) {
        pendingRoots.clear();
        return;
      }

      ensureStyles(doc, underlineToneColor(profile.underlineTone));
      observer?.disconnect();
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      for (const pendingRoot of roots) {
        const connectedRoot =
          pendingRoot instanceof Node && 'isConnected' in pendingRoot ? pendingRoot.isConnected : true;
        if (!connectedRoot) {
          continue;
        }
        scanRoot(pendingRoot);
      }
      observeBody();
    }, RESCAN_DELAY_MS);
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

      for (const node of Array.from(mutation.addedNodes)) {
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
  observeBody();

  return {
    rescan() {
      if (disposed || !doc.body) {
        return;
      }

      ensureStyles(doc, underlineToneColor(profile.underlineTone));
      observer?.disconnect();
      scanRoot(doc.body);
      observeBody();
    },
    updateProfile(nextProfile) {
      profile = nextProfile;
      ensureStyles(doc, underlineToneColor(profile.underlineTone));
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
      if (rescanTimer) {
        window.clearTimeout(rescanTimer);
        rescanTimer = 0;
      }
      pendingRoots.clear();
      observer?.disconnect();
      observer = null;
      tooltip.hide();
    }
  };
}
