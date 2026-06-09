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

export interface PlacementConstraints {
  topInset?: number;
}

const EDGE_MARGIN = 8;
const HORIZONTAL_GAP = 8;
const HIGH_LIFT = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampToViewportY(y: number, cardHeight: number, viewportHeight: number, topInset = 0): number {
  const minY = EDGE_MARGIN + Math.max(0, topInset);
  const maxY = Math.max(EDGE_MARGIN, viewportHeight - cardHeight - EDGE_MARGIN);
  return clamp(y, minY, maxY);
}

function canFitX(x: number, cardWidth: number, viewportWidth: number): boolean {
  return x >= EDGE_MARGIN && x + cardWidth <= viewportWidth - EDGE_MARGIN;
}

function chooseVerticalPlacement(
  anchor: RectLike,
  viewport: SizeLike,
  card: SizeLike,
  topInset: number
): { y: number; vertical: 'above' | 'below' } {
  const highY = anchor.y - card.height - HIGH_LIFT;
  const belowY = anchor.y + anchor.height + HORIZONTAL_GAP;
  const safeTop = EDGE_MARGIN + Math.max(0, topInset);
  const canFitBelow = belowY + card.height <= viewport.height - EDGE_MARGIN;
  if (topInset > 0 && highY < safeTop && canFitBelow) {
    return { y: belowY, vertical: 'below' };
  }

  return {
    y: clampToViewportY(highY, card.height, viewport.height, topInset),
    vertical: 'above'
  };
}

export function chooseTooltipPlacement(
  anchor: RectLike,
  viewport: SizeLike,
  card: SizeLike,
  constraints: PlacementConstraints = {}
): TooltipPlacement {
  const rightX = anchor.x + anchor.width + HORIZONTAL_GAP;
  const leftX = anchor.x - card.width - HORIZONTAL_GAP;
  const belowY = anchor.y + anchor.height + HORIZONTAL_GAP;
  const verticalPlacement = chooseVerticalPlacement(anchor, viewport, card, constraints.topInset ?? 0);

  if (canFitX(rightX, card.width, viewport.width)) {
    return {
      x: rightX,
      y: verticalPlacement.y,
      side: 'right',
      vertical: verticalPlacement.vertical,
      verticalOffset: verticalPlacement.y - anchor.y
    };
  }

  if (canFitX(leftX, card.width, viewport.width)) {
    return {
      x: leftX,
      y: verticalPlacement.y,
      side: 'left',
      vertical: verticalPlacement.vertical,
      verticalOffset: verticalPlacement.y - anchor.y
    };
  }

  const preferredX = canFitX(rightX, card.width, viewport.width) ? rightX : leftX;
  const clampedX = clamp(preferredX, EDGE_MARGIN, viewport.width - card.width - EDGE_MARGIN);
  const clampedY = clampToViewportY(belowY, card.height, viewport.height, constraints.topInset ?? 0);

  return {
    x: clampedX,
    y: clampedY,
    side: preferredX === rightX ? 'right' : 'left',
    vertical: 'below',
    verticalOffset: clampedY - anchor.y
  };
}
