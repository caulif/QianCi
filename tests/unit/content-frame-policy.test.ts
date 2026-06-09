import { describe, expect, it } from 'vitest';
import { shouldBootstrapContentFrame } from '../../src/content/framePolicy';

describe('content frame policy', () => {
  it('allows the top frame to bootstrap', () => {
    const frame = {};

    expect(shouldBootstrapContentFrame({ self: frame, top: frame })).toBe(true);
  });

  it('blocks child frames by default', () => {
    expect(shouldBootstrapContentFrame({ self: {}, top: {} })).toBe(false);
  });
});
