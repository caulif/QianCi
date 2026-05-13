import type { UserLevel } from './types';

const LEVEL_THRESHOLDS: Record<UserLevel, number> = {
  starter: 1800,
  cet4: 5500,
  cet6: 9000,
  graduate: 12500,
  'ielts-toefl': 17000,
  professional: 23000
};

export function getRankThresholdForLevel(level: UserLevel): number {
  return LEVEL_THRESHOLDS[level];
}

export function normalizeRank(rank: number | undefined): number {
  if (!rank || !Number.isFinite(rank) || rank < 1) {
    return 999_999;
  }
  return Math.floor(rank);
}
