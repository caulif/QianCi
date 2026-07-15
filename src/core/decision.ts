import { getRankThresholdForLevel, normalizeRank } from './rank';
import { getBaseLevelScore, normalizeAnnotationDensity } from './profile';
import type { SiteMode, UserProfile, WordCandidate } from './types';
import { shouldStopAnnotating } from './profile';
import { LOW_DENSITY_SITE_MULTIPLIER } from './sitePolicy';

const LEVEL_SCORE_RANK_STEP = 2800;

export interface AnnotateDecisionOptions {
  siteMode?: SiteMode;
}

function effectiveAnnotationDensity(profile: UserProfile, siteMode?: SiteMode): number {
  const base = normalizeAnnotationDensity(profile.annotationDensity);
  if (siteMode === 'low-density') {
    return Math.max(0.5, Number((base * LOW_DENSITY_SITE_MULTIPLIER).toFixed(2)));
  }
  return base;
}

function adaptiveThreshold(profile: UserProfile, siteMode?: SiteMode): number {
  const baseThreshold = getRankThresholdForLevel(profile.level);
  const baseScore = getBaseLevelScore(profile.level);
  const offset = (profile.levelScore - baseScore) * LEVEL_SCORE_RANK_STEP;
  const density = effectiveAnnotationDensity(profile, siteMode);
  return Math.max(500, Math.round((baseThreshold + offset) / density));
}

export function shouldAnnotateWord(
  profile: UserProfile,
  candidate: WordCandidate,
  options: AnnotateDecisionOptions = {}
): boolean {
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
  return rank > adaptiveThreshold(profile, options.siteMode);
}
