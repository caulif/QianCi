export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SizeLike {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  x: number;
  y: number;
  side: 'right' | 'left';
  vertical: 'above' | 'below';
  verticalOffset: number;
}

const EDGE_MARGIN = 8;
const HORIZONTAL_GAP = 8;
const HIGH_LIFT = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canFitX(x: number, cardWidth: number, viewportWidth: number): boolean {
  return x >= EDGE_MARGIN && x + cardWidth <= viewportWidth - EDGE_MARGIN;
}

function canFitY(y: number, cardHeight: number, viewportHeight: number): boolean {
  return y >= EDGE_MARGIN && y + cardHeight <= viewportHeight - EDGE_MARGIN;
}

export function chooseTooltipPlacement(anchor: RectLike, viewport: SizeLike, card: SizeLike): TooltipPlacement {
  const rightX = anchor.x + anchor.width + HORIZONTAL_GAP;
  const leftX = anchor.x - card.width - HORIZONTAL_GAP;
  const highY = anchor.y - card.height - HIGH_LIFT;
  const belowY = anchor.y + anchor.height + HORIZONTAL_GAP;

  if (canFitX(rightX, card.width, viewport.width) && canFitY(highY, card.height, viewport.height)) {
    return {
      x: rightX,
      y: highY,
      side: 'right',
      vertical: 'above',
      verticalOffset: highY - anchor.y
    };
  }

  if (canFitX(leftX, card.width, viewport.width) && canFitY(highY, card.height, viewport.height)) {
    return {
      x: leftX,
      y: highY,
      side: 'left',
      vertical: 'above',
      verticalOffset: highY - anchor.y
    };
  }

  const preferredX = canFitX(rightX, card.width, viewport.width) ? rightX : leftX;
  const clampedX = clamp(preferredX, EDGE_MARGIN, viewport.width - card.width - EDGE_MARGIN);
  const clampedY = clamp(belowY, EDGE_MARGIN, viewport.height - card.height - EDGE_MARGIN);

  return {
    x: clampedX,
    y: clampedY,
    side: preferredX === rightX ? 'right' : 'left',
    vertical: 'below',
    verticalOffset: clampedY - anchor.y
  };
}
