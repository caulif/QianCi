import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { RectLike } from './placement';
import { chooseTooltipPlacement } from './placement';

export interface TooltipController {
  showEntry(anchor: HTMLElement | RectLike, entry: DictionaryEntry, onKnown: () => void): void;
  showMissing(anchor: HTMLElement | RectLike, word: string, onLookup: () => void, message?: string): void;
  showLoading(anchor: HTMLElement | RectLike, word: string): void;
  cancelHide(): void;
  scheduleHide(): void;
  hide(): void;
}

const TOOLTIP_WIDTH = 190;
const TOOLTIP_HEIGHT = 92;
const HIDE_DELAY_MS = 140;

function appendTextLine(doc: Document, parent: HTMLElement, text: string, className: string): void {
  const line = doc.createElement('div');
  line.className = className;
  line.textContent = text;
  parent.append(line);
}

function compactTranslation(text: string): string {
  return text
    .split(/[；;\n]+/)
    .map((part) => part.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('；');
}

export function createTooltipController(doc: Document): TooltipController {
  const tooltip = doc.createElement('div');
  tooltip.dataset.qianciTooltip = 'true';
  tooltip.style.position = 'fixed';
  tooltip.style.zIndex = '2147483647';
  tooltip.style.width = `${TOOLTIP_WIDTH}px`;
  tooltip.style.boxSizing = 'border-box';
  tooltip.style.padding = '8px 10px';
  tooltip.style.border = '1px solid rgba(70, 66, 58, 0.18)';
  tooltip.style.borderRadius = '6px';
  tooltip.style.background = '#fffefc';
  tooltip.style.color = '#202020';
  tooltip.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
  tooltip.style.font = '12px/1.35 Inter, ui-sans-serif, system-ui, sans-serif';
  tooltip.style.display = 'none';
  tooltip.style.pointerEvents = 'auto';
  let hideTimer = 0;

  function ensureMounted(): void {
    if (!tooltip.isConnected) {
      doc.body.append(tooltip);
    }
  }

  function cancelHide(): void {
    if (!hideTimer) {
      return;
    }
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function hideNow(): void {
    cancelHide();
    tooltip.style.display = 'none';
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      tooltip.style.display = 'none';
    }, HIDE_DELAY_MS);
  }

  function place(anchor: HTMLElement | RectLike): void {
    const rect =
      'getBoundingClientRect' in anchor
        ? anchor.getBoundingClientRect()
        : { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height };
    const view = doc.defaultView ?? window;
    const placement = chooseTooltipPlacement(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      { width: view.innerWidth || 1280, height: view.innerHeight || 900 },
      { width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT }
    );

    tooltip.style.left = `${placement.x}px`;
    tooltip.style.top = `${placement.y}px`;
    tooltip.style.display = 'block';
  }

  function render(anchor: HTMLElement | RectLike, build: (card: HTMLElement) => void): void {
    cancelHide();
    ensureMounted();
    tooltip.replaceChildren();
    build(tooltip);
    place(anchor);
  }

  tooltip.addEventListener('mouseenter', cancelHide);
  tooltip.addEventListener('mouseleave', scheduleHide);

  return {
    showEntry(anchor, entry, onKnown) {
      render(anchor, (card) => {
        const header = doc.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.gap = '8px';

        const word = doc.createElement('strong');
        word.textContent = entry.word;
        word.style.fontSize = '13px';
        header.append(word);

        const known = doc.createElement('button');
        known.type = 'button';
        known.textContent = '认识';
        known.style.border = '0';
        known.style.borderRadius = '4px';
        known.style.padding = '2px 6px';
        known.style.background = '#f1f0ec';
        known.style.color = '#555';
        known.style.font = '11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif';
        known.onclick = onKnown;
        header.append(known);
        card.append(header);

        appendTextLine(doc, card, entry.phonetic, 'qianci-tooltip-phonetic');
        appendTextLine(doc, card, compactTranslation(entry.translation), 'qianci-tooltip-translation');

        if (entry.attribution) {
          const meta = doc.createElement('div');
          meta.style.marginTop = '6px';
          meta.style.fontSize = '11px';
          meta.style.color = '#7a7368';
          const source = doc.createElement('a');
          source.href = entry.attribution.url;
          source.target = '_blank';
          source.rel = 'noreferrer';
          source.textContent = entry.attribution.label;
          source.style.color = 'inherit';
          source.style.textDecoration = 'none';
          meta.append(source);

          if (entry.attribution.serviceUrl) {
            const divider = doc.createTextNode(' · ');
            meta.append(divider);

            const service = doc.createElement('a');
            service.href = entry.attribution.serviceUrl;
            service.target = '_blank';
            service.rel = 'noreferrer';
            service.textContent = entry.attribution.serviceLabel ?? 'FreeDictionaryAPI';
            service.style.color = 'inherit';
            service.style.textDecoration = 'none';
            meta.append(service);
          }
          card.append(meta);
        }
      });
    },
    showMissing(anchor, word, onLookup, message = '词库里没有') {
      render(anchor, (card) => {
        const header = doc.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.gap = '8px';

        const label = doc.createElement('strong');
        label.textContent = word;
        label.style.fontSize = '13px';
        header.append(label);

        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = '联网查询';
        button.style.border = '0';
        button.style.borderRadius = '4px';
        button.style.padding = '2px 6px';
        button.style.background = '#f1f0ec';
        button.style.color = '#555';
        button.style.font = '11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif';
        button.onclick = () => {
          void onLookup();
        };
        header.append(button);
        card.append(header);

        appendTextLine(doc, card, message, 'qianci-tooltip-translation');
      });
    },
    showLoading(anchor, word) {
      render(anchor, (card) => {
        const line = doc.createElement('div');
        line.textContent = `${word} 正在联网查询...`;
        line.style.fontSize = '12px';
        line.style.color = '#555';
        card.append(line);
      });
    },
    cancelHide,
    scheduleHide,
    hide: hideNow
  };
}
