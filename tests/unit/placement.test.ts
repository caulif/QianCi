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

  it('falls below the word when there is not enough space above', () => {
    const placement = chooseTooltipPlacement(
      { x: 240, y: 18, width: 64, height: 20 },
      { width: 1280, height: 900 },
      { width: 180, height: 88 }
    );

    expect(placement.vertical).toBe('below');
    expect(placement.y).toBeGreaterThan(18);
  });
});
