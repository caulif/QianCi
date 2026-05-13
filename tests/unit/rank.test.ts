import { describe, expect, it } from 'vitest';
import { getRankThresholdForLevel, normalizeRank } from '../../src/core/rank';

describe('rank helpers', () => {
  it('maps coarse user levels to increasing rank thresholds', () => {
    expect(getRankThresholdForLevel('starter')).toBeLessThan(getRankThresholdForLevel('cet4'));
    expect(getRankThresholdForLevel('cet4')).toBeLessThan(getRankThresholdForLevel('cet6'));
    expect(getRankThresholdForLevel('cet6')).toBeLessThan(getRankThresholdForLevel('professional'));
  });

  it('normalizes missing or invalid ranks as rare words', () => {
    expect(normalizeRank(undefined)).toBe(999_999);
    expect(normalizeRank(0)).toBe(999_999);
    expect(normalizeRank(1200)).toBe(1200);
  });
});
