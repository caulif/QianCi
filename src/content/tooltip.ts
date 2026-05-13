import type { DictionaryEntry } from './app';
import { chooseTooltipPlacement } from './placement';

export interface TooltipController {
  show(anchor: HTMLElement, entry: DictionaryEntry, onKnown: () => void): void;
  hide(): void;
}

const TOOLTIP_WIDTH = 190;
const TOOLTIP_HEIGHT = 92;

function appendTextLine(doc: Document, parent: HTMLElement, text: string, className: string): void {
  const line = doc.createElement('div');
  line.className = className;
  line.textContent = text;
  parent.append(line);
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

  function ensureMounted(): void {
    if (!tooltip.isConnected) {
      doc.body.append(tooltip);
    }
  }

  return {
    show(anchor, entry, onKnown) {
      ensureMounted();
      tooltip.replaceChildren();

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
      known.addEventListener('click', onKnown);
      header.append(known);
      tooltip.append(header);

      appendTextLine(doc, tooltip, entry.phonetic, 'qianci-tooltip-phonetic');
      appendTextLine(doc, tooltip, entry.translation, 'qianci-tooltip-translation');

      const rect = anchor.getBoundingClientRect();
      const placement = chooseTooltipPlacement(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        { width: window.innerWidth || 1280, height: window.innerHeight || 900 },
        { width: TOOLTIP_WIDTH, height: TOOLTIP_HEIGHT }
      );

      tooltip.style.left = `${placement.x}px`;
      tooltip.style.top = `${placement.y}px`;
      tooltip.style.display = 'block';
    },
    hide() {
      tooltip.style.display = 'none';
    }
  };
}
