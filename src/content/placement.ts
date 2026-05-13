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

function clampToViewportY(y: number, cardHeight: number, viewportHeight: number): number {
  const maxY = Math.max(EDGE_MARGIN, viewportHeight - cardHeight - EDGE_MARGIN);
  return clamp(y, EDGE_MARGIN, maxY);
}

function canFitX(x: number, cardWidth: number, viewportWidth: number): boolean {
  return x >= EDGE_MARGIN && x + cardWidth <= viewportWidth - EDGE_MARGIN;
}

export function chooseTooltipPlacement(anchor: RectLike, viewport: SizeLike, card: SizeLike): TooltipPlacement {
  const rightX = anchor.x + anchor.width + HORIZONTAL_GAP;
  const leftX = anchor.x - card.width - HORIZONTAL_GAP;
  const highY = anchor.y - card.height - HIGH_LIFT;
  const belowY = anchor.y + anchor.height + HORIZONTAL_GAP;
  const aboveY = clampToViewportY(highY, card.height, viewport.height);

  if (canFitX(rightX, card.width, viewport.width)) {
    return {
      x: rightX,
      y: aboveY,
      side: 'right',
      vertical: 'above',
      verticalOffset: aboveY - anchor.y
    };
  }

  if (canFitX(leftX, card.width, viewport.width)) {
    return {
      x: leftX,
      y: aboveY,
      side: 'left',
      vertical: 'above',
      verticalOffset: aboveY - anchor.y
    };
  }

  const preferredX = canFitX(rightX, card.width, viewport.width) ? rightX : leftX;
  const clampedX = clamp(preferredX, EDGE_MARGIN, viewport.width - card.width - EDGE_MARGIN);
  const clampedY = clampToViewportY(belowY, card.height, viewport.height);

  return {
    x: clampedX,
    y: clampedY,
    side: preferredX === rightX ? 'right' : 'left',
    vertical: 'below',
    verticalOffset: clampedY - anchor.y
  };
}
