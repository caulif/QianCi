import { describe, expect, it } from 'vitest';
import { chooseTooltipPlacement } from '../../src/content/placement';

describe('tooltip placement', () => {
  it('prefers a raised right placement so it does not cover same-line text', () => {
    const placement = chooseTooltipPlacement(
      { x: 240, y: 180, width: 64, height: 20 },
      { width: 1280, height: 900 },
      { width: 180, height: 88 }
    );

    expect(placement.side).toBe('right');
    expect(placement.x).toBeGreaterThan(304);
    expect(placement.y).toBeLessThan(180);
  });

  it('uses the left side when the right side would overflow', () => {
    const placement = chooseTooltipPlacement(
      { x: 1160, y: 180, width: 64, height: 20 },
      { width: 1280, height: 900 },
      { width: 180, height: 88 }
    );

    expect(placement.side).toBe('left');
    expect(placement.x).toBeLessThan(1160);
  });

  it('falls below the word when neither side can keep the card beside the word', () => {
    const placement = chooseTooltipPlacement(
      { x: 100, y: 18, width: 64, height: 20 },
      { width: 260, height: 900 },
      { width: 180, height: 88 }
    );

    expect(placement.vertical).toBe('below');
    expect(placement.y).toBeGreaterThan(18);
  });

  it('keeps the tooltip above the word near the top edge when the right side fits', () => {
    const placement = chooseTooltipPlacement(
      { x: 240, y: 40, width: 64, height: 20 },
      { width: 1280, height: 900 },
      { width: 180, height: 88 }
    );

    expect(placement.side).toBe('right');
    expect(placement.vertical).toBe('above');
    expect(placement.y).toBeLessThan(40);
  });
});
