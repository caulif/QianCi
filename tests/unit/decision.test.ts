import { describe, expect, it } from 'vitest';
import { shouldAnnotateWord } from '../../src/core/decision';
import { applyKnownFeedback, applyLookupFeedback, applySkipFeedback, createProfile } from '../../src/core/profile';

describe('annotation decision', () => {
  it('annotates words above the user threshold and skips common words', () => {
    const profile = createProfile('cet4');

    expect(shouldAnnotateWord(profile, { word: 'meticulous', rank: 12_000 })).toBe(true);
    expect(shouldAnnotateWord(profile, { word: 'apple', rank: 500 })).toBe(false);
  });

  it('never annotates words explicitly marked known', () => {
    const profile = applyKnownFeedback(createProfile('starter'), 'meticulous', 100);

    expect(shouldAnnotateWord(profile, { word: 'meticulous', rank: 99_000 })).toBe(false);
  });

  it('continues annotating looked-up unknown words unless familiarity is high', () => {
    const unknown = applyLookupFeedback(createProfile('professional'), 'abrupt', 'hover', 100);
    const skippedOnce = applySkipFeedback(unknown, 'abrupt', 'a', 200);
    const skippedTwice = applySkipFeedback(skippedOnce, 'abrupt', 'b', 300);
    const skippedThreeTimes = applySkipFeedback(skippedTwice, 'abrupt', 'c', 400);

    expect(shouldAnnotateWord(skippedTwice, { word: 'abrupt', rank: 2000 })).toBe(true);
    expect(shouldAnnotateWord(skippedThreeTimes, { word: 'abrupt', rank: 2000 })).toBe(false);
  });

  it('uses level score to make the same level more or less aggressive', () => {
    const lower = createProfile('cet4');
    const higher = { ...createProfile('cet4'), levelScore: 4.2 };

    expect(shouldAnnotateWord(lower, { word: 'nuance', rank: 9_000 })).toBe(true);
    expect(shouldAnnotateWord(higher, { word: 'nuance', rank: 9_000 })).toBe(false);
  });
});
