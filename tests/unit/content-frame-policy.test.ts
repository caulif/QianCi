import { describe, expect, it } from 'vitest';
import { resolvePolicyUrl, shouldBootstrapContentFrame } from '../../src/content/framePolicy';

describe('content frame policy', () => {
  it('allows the top frame to bootstrap', () => {
    const frame = {};

    expect(shouldBootstrapContentFrame({ self: frame, top: frame })).toBe(true);
  });

  it('blocks child frames by default', () => {
    expect(shouldBootstrapContentFrame({ self: {}, top: {} })).toBe(false);
  });

  it('allows same-origin child frames when explicitly opted in', () => {
    const top = { location: { href: 'https://example.com/course' } };
    const child = { location: { href: 'https://example.com/embed' } };

    expect(
      shouldBootstrapContentFrame(
        { self: child, top },
        { allowSameOriginFrames: true }
      )
    ).toBe(true);
  });

  it('blocks cross-origin child frames even when frame opt-in is enabled', () => {
    const top = {
      get location() {
        throw new Error('Blocked a frame with origin');
      }
    };

    expect(
      shouldBootstrapContentFrame(
        { self: {}, top },
        { allowSameOriginFrames: true }
      )
    ).toBe(false);
  });

  it('prefers the top page url for site policy when accessible', () => {
    const top = { location: { href: 'https://example.com/top' } };
    const child = { location: { href: 'https://example.com/frame' } };
    expect(resolvePolicyUrl({ self: child, top, location: child.location })).toBe('https://example.com/top');
  });
});
