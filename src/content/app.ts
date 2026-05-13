import { shouldAnnotateWord } from '../core/decision';
import { applyKnownFeedback, applyLookupFeedback, applySkipFeedback } from '../core/profile';
import type { UserProfile } from '../core/types';
import { createAnnotatedFragment } from './annotator';
import { normalizeSelectedWord } from './selection';
import { createTooltipController } from './tooltip';

export interface DictionaryEntry {
  word: string;
  phonetic: string;
  translation: string;
  rank: number;
}

export type DictionaryIndex = Record<string, DictionaryEntry>;

export interface ContentServices {
  profile: UserProfile;
  dictionary: DictionaryIndex;
  onKnown(word: string, profile: UserProfile): void | Promise<void>;
  onLookup(word: string, mode: 'hover' | 'alt', profile: UserProfile): void | Promise<void>;
  onSkip(word: string, pageKey: string, profile: UserProfile): void | Promise<void>;
}

export interface ContentApp {
  rescan(): void;
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

function ensureStyles(doc: Document): void {
  if (doc.querySelector('[data-qianci-style]')) {
    return;
  }

  const style = doc.createElement('style');
  style.dataset.qianciStyle = 'true';
  style.textContent = `
    .qianci-word {
      border-bottom: 1px dashed rgba(84, 84, 84, 0.48);
      cursor: help;
      text-decoration: none;
    }
  `;
  doc.head.append(style);
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

export function createContentApp(doc: Document, services: ContentServices): ContentApp {
  let disposed = false;
  let profile = services.profile;
  const tooltip = createTooltipController(doc);
  const skipTimers = new Set<number>();

  function pageKey(): string {
    return doc.location?.href || 'document';
  }

  function isElementVisible(element: HTMLElement): boolean {
    const view = doc.defaultView ?? window;
    const rect = element.getBoundingClientRect();
    return rect.top <= view.innerHeight && rect.bottom >= 0;
  }

  function knownAction(anchor: HTMLElement, word: string): () => void {
    return () => {
      profile = applyKnownFeedback(profile, word, Date.now());
      void services.onKnown(word, profile);
      tooltip.hide();
      if (anchor.dataset.qianciWord) {
        removeAnnotationElement(anchor);
      }
    };
  }

  function bindWordElement(element: HTMLElement): void {
    const word = element.dataset.qianciWord;
    if (!word) {
      return;
    }

    let interacted = false;
    const timer = window.setTimeout(() => {
      skipTimers.delete(timer);
      if (!disposed && !interacted && element.isConnected && isElementVisible(element)) {
        profile = applySkipFeedback(profile, word, pageKey(), Date.now());
        void services.onSkip(word, pageKey(), profile);
      }
    }, 3500);
    skipTimers.add(timer);

    element.addEventListener('mouseenter', () => {
      interacted = true;
      const entry = services.dictionary[word];
      if (!entry) {
        return;
      }
      profile = applyLookupFeedback(profile, word, 'hover', Date.now());
      void services.onLookup(word, 'hover', profile);
      tooltip.show(element, entry, knownAction(element, word));
    });

    element.addEventListener('mouseleave', () => {
      tooltip.hide();
    });
  }

  function handleAltSelection(event: MouseEvent): void {
    if (!event.altKey) {
      return;
    }

    const selectedWord = normalizeSelectedWord(doc.getSelection()?.toString() ?? '');
    if (!selectedWord) {
      return;
    }

    const entry = services.dictionary[selectedWord];
    if (!entry) {
      return;
    }

    profile = applyLookupFeedback(profile, selectedWord, 'alt', Date.now());
    void services.onLookup(selectedWord, 'alt', profile);

    const target = event.target;
    const anchor = target instanceof HTMLElement ? target : doc.body;
    tooltip.show(anchor, entry, knownAction(anchor, selectedWord));
  }

  function annotateTextNode(textNode: Text): void {
    const fragment = createAnnotatedFragment(textNode.data, (token) => {
      const entry = services.dictionary[token.normalized];
      if (!entry) {
        return false;
      }
      return shouldAnnotateWord(profile, { word: token.normalized, rank: entry.rank });
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

  doc.addEventListener('mouseup', handleAltSelection);

  return {
    rescan() {
      if (disposed || !doc.body) {
        return;
      }

      ensureStyles(doc);
      for (const textNode of collectTextNodes(doc.body)) {
        annotateTextNode(textNode);
      }
    },
    dispose() {
      disposed = true;
      doc.removeEventListener('mouseup', handleAltSelection);
      for (const timer of skipTimers) {
        window.clearTimeout(timer);
      }
      skipTimers.clear();
      tooltip.hide();
    }
  };
}
