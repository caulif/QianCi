import { describe, expect, it } from 'vitest';
import {
  applyKnownFeedback,
  applyLookupFeedback,
  applySkipFeedback,
  createProfile
} from '../../src/core/profile';

describe('profile feedback', () => {
  it('raises the level score when the user marks a word as known', () => {
    const base = createProfile('cet4');
    const updated = applyKnownFeedback(base, 'apple', 100);

    expect(updated.levelScore).toBeGreaterThan(base.levelScore);
    expect(updated.words.apple?.isKnown).toBe(true);
    expect(updated.words.apple?.isUnknown).toBe(false);
  });

  it('lowers the level score more for Alt lookup than hover lookup', () => {
    const base = createProfile('cet6');
    const afterHover = applyLookupFeedback(base, 'abrupt', 'hover', 200);
    const afterAlt = applyLookupFeedback(base, 'serendipity', 'alt', 300);

    expect(afterHover.levelScore).toBeLessThan(base.levelScore);
    expect(afterAlt.levelScore).toBeLessThan(afterHover.levelScore);
    expect(afterAlt.words.serendipity?.isUnknown).toBe(true);
  });

  it('counts skipped annotated words as weak familiarity only once per page', () => {
    const base = createProfile('cet4');
    const once = applySkipFeedback(base, 'coherence', 'https://example.com/article', 500);
    const twiceSamePage = applySkipFeedback(once, 'coherence', 'https://example.com/article', 800);
    const secondPage = applySkipFeedback(twiceSamePage, 'coherence', 'https://example.com/next', 1000);

    expect(once.words.coherence?.familiarity).toBe(1);
    expect(twiceSamePage.words.coherence?.familiarity).toBe(1);
    expect(secondPage.words.coherence?.familiarity).toBe(2);
    expect(secondPage.words.coherence?.isKnown).toBe(false);
  });
});
