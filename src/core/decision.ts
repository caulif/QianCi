import { getRankThresholdForLevel, normalizeRank } from './rank';
import type { UserProfile, WordCandidate } from './types';
import { shouldStopAnnotating } from './profile';

export function shouldAnnotateWord(profile: UserProfile, candidate: WordCandidate): boolean {
  const state = profile.words[candidate.word];

  if (shouldStopAnnotating(state)) {
    return false;
  }

  if (state?.isUnknown) {
    return true;
  }

  const rank = normalizeRank(candidate.rank);
  return rank > getRankThresholdForLevel(profile.level);
}
