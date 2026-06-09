import { getRankThresholdForLevel, normalizeRank } from './rank';
import { getBaseLevelScore, normalizeAnnotationDensity } from './profile';
import type { UserProfile, WordCandidate } from './types';
import { shouldStopAnnotating } from './profile';

const LEVEL_SCORE_RANK_STEP = 2800;

function adaptiveThreshold(profile: UserProfile): number {
  const baseThreshold = getRankThresholdForLevel(profile.level);
  const baseScore = getBaseLevelScore(profile.level);
  const offset = (profile.levelScore - baseScore) * LEVEL_SCORE_RANK_STEP;
  return Math.max(500, Math.round((baseThreshold + offset) / normalizeAnnotationDensity(profile.annotationDensity)));
}

export function shouldAnnotateWord(profile: UserProfile, candidate: WordCandidate): boolean {
  const state = profile.words[candidate.word];

  if (shouldStopAnnotating(state, profile.feedbackSettings)) {
    return false;
  }

  if (state?.alwaysAnnotate) {
    return true;
  }

  if (state?.isUnknown) {
    return true;
  }

  const rank = normalizeRank(candidate.rank);
  return rank > adaptiveThreshold(profile);
}
