import { describe, expect, it } from 'vitest';
import {
  applyKnownFeedback,
  applyLookupFeedback,
  applySkipFeedback,
  createProfile,
  markWordAlwaysAnnotate,
  normalizeProfile,
  resetSkipFeedback,
  shouldStopAnnotating,
  unmarkWordAlwaysAnnotate
} from '../../src/core/profile';

describe('profile feedback', () => {
  it('creates a profile with default interaction settings', () => {
    const profile = createProfile('cet4');

    expect(profile.underlineTone).toBe('graphite');
    expect(profile.lookupTrigger).toBe('hover');
    expect(profile.manualShortcut).toBe('alt');
    expect(profile.annotationDensity).toBe(1);
    expect(profile.onboardingDismissedAt).toBeUndefined();
    expect(profile.feedbackSettings).toEqual({
      skipLimit: 3,
      skipDelayMs: 3500,
      decayHalfLifeDays: 30,
      suppressionMode: 'balanced'
    });
  });

  it('backfills feedback settings when normalizing an older profile', () => {
    const olderProfile = createProfile('cet4');
    const normalized = normalizeProfile({
      ...olderProfile,
      feedbackSettings: undefined
    } as never);

    expect(normalized.feedbackSettings.skipLimit).toBe(3);
    expect(normalized.feedbackSettings.skipDelayMs).toBe(3500);
    expect(normalized.feedbackSettings.suppressionMode).toBe('balanced');
    expect(normalized.annotationDensity).toBe(1);
    expect(normalized.onboardingDismissedAt).toBeUndefined();
  });

  it('repairs invalid annotation density from damaged storage data', () => {
    const normalized = normalizeProfile({
      ...createProfile('cet4'),
      annotationDensity: Number.NaN
    } as never);

    expect(normalized.annotationDensity).toBe(1);
  });

  it('clamps annotation density into the supported range', () => {
    const tooLow = normalizeProfile({
      ...createProfile('cet4'),
      annotationDensity: 0.2
    } as never);
    const tooHigh = normalizeProfile({
      ...createProfile('cet4'),
      annotationDensity: 2
    } as never);

    expect(tooLow.annotationDensity).toBe(0.75);
    expect(tooHigh.annotationDensity).toBe(1.25);
  });

  it('repairs invalid feedback settings from damaged storage data', () => {
    const normalized = normalizeProfile({
      ...createProfile('cet4'),
      feedbackSettings: {
        skipLimit: -1,
        skipDelayMs: Number.NaN,
        decayHalfLifeDays: 0,
        suppressionMode: 'aggressive'
      }
    } as never);

    expect(normalized.feedbackSettings).toEqual({
      skipLimit: 2,
      skipDelayMs: 2500,
      decayHalfLifeDays: 21,
      suppressionMode: 'aggressive'
    });
  });

  it('raises the level score when the user marks a word as known', () => {
    const base = createProfile('cet4');
    const updated = applyKnownFeedback(base, 'apple', 100);

    expect(updated.levelScore).toBeGreaterThan(base.levelScore);
    expect(updated.words.apple?.isKnown).toBe(true);
    expect(updated.words.apple?.isUnknown).toBe(false);
  });

  it('lowers the level score more for manual lookup than hover lookup', () => {
    const base = createProfile('cet6');
    const afterHover = applyLookupFeedback(base, 'abrupt', 'hover', 200);
    const afterAlt = applyLookupFeedback(base, 'serendipity', 'selection', 300);

    expect(afterHover.levelScore).toBeLessThan(base.levelScore);
    expect(afterAlt.levelScore).toBeLessThan(afterHover.levelScore);
    expect(afterAlt.words.serendipity?.isUnknown).toBe(true);
  });

  it('keeps known words known when they are looked up again', () => {
    const known = applyKnownFeedback(createProfile('cet4'), 'abrupt', 100);
    const lookedUp = applyLookupFeedback(known, 'abrupt', 'selection', 200);

    expect(lookedUp.words.abrupt?.isKnown).toBe(true);
    expect(lookedUp.words.abrupt?.isUnknown).toBe(false);
    expect(lookedUp.levelScore).toBe(known.levelScore);
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

  it('uses the configured skip limit to decide when weak feedback suppresses annotation', () => {
    const state = {
      familiarity: 2,
      isKnown: false,
      isUnknown: false,
      lastSeenAt: 100,
      seenPages: {}
    };

    expect(shouldStopAnnotating(state, { skipLimit: 3 })).toBe(false);
    expect(shouldStopAnnotating(state, { skipLimit: 2 })).toBe(true);
  });

  it('resets weak skip feedback without changing known or unknown flags', () => {
    const skipped = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    const unknownSkipped = applyLookupFeedback(skipped, 'coherence', 'selection', 200);
    const reset = resetSkipFeedback(unknownSkipped, 'coherence');

    expect(reset.words.coherence?.familiarity).toBe(0);
    expect(reset.words.coherence?.seenPages).toEqual({});
    expect(reset.words.coherence?.isUnknown).toBe(true);
    expect(reset.words.coherence?.isKnown).toBe(false);
  });

  it('marks a word as always annotated and ignores weak skip suppression', () => {
    const skippedOnce = applySkipFeedback(createProfile('cet4'), 'coherence', 'page-a', 100);
    const skippedTwice = applySkipFeedback(skippedOnce, 'coherence', 'page-b', 200);
    const skippedThreeTimes = applySkipFeedback(skippedTwice, 'coherence', 'page-c', 300);
    const alwaysAnnotated = markWordAlwaysAnnotate(skippedThreeTimes, 'coherence', 400);

    expect(alwaysAnnotated.words.coherence?.alwaysAnnotate).toBe(true);
    expect(alwaysAnnotated.words.coherence?.familiarity).toBe(0);
    expect(alwaysAnnotated.words.coherence?.seenPages).toEqual({});
    expect(shouldStopAnnotating(alwaysAnnotated.words.coherence, alwaysAnnotated.feedbackSettings)).toBe(false);
  });

  it('keeps known words suppressed even if they were previously set to always annotate', () => {
    const alwaysAnnotated = markWordAlwaysAnnotate(createProfile('cet4'), 'coherence', 100);
    const known = applyKnownFeedback(alwaysAnnotated, 'coherence', 200);

    expect(known.words.coherence?.isKnown).toBe(true);
    expect(known.words.coherence?.alwaysAnnotate).toBe(false);
    expect(shouldStopAnnotating(known.words.coherence, known.feedbackSettings)).toBe(true);
  });

  it('can remove the always annotated preference without restoring old skip counts', () => {
    const alwaysAnnotated = markWordAlwaysAnnotate(createProfile('cet4'), 'coherence', 100);
    const unmarked = unmarkWordAlwaysAnnotate(alwaysAnnotated, 'coherence');

    expect(unmarked.words.coherence?.alwaysAnnotate).toBe(false);
    expect(unmarked.words.coherence?.familiarity).toBe(0);
    expect(unmarked.words.coherence?.seenPages).toEqual({});
  });
});
