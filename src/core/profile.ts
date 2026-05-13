import type { UserLevel, UserProfile, WordState } from './types';

const MIN_LEVEL = 1;
const MAX_LEVEL = 6;
const SKIP_FAMILIARITY_LIMIT = 3;
const LEVEL_DELTA = {
  known: 0.18,
  hover: -0.04,
  alt: -0.14
} as const;

function clampLevelScore(value: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Number(value.toFixed(2))));
}

function createWordState(previous?: WordState): WordState {
  return {
    familiarity: previous?.familiarity ?? 0,
    isKnown: previous?.isKnown ?? false,
    isUnknown: previous?.isUnknown ?? false,
    lastSeenAt: previous?.lastSeenAt ?? 0,
    seenPages: previous?.seenPages ? { ...previous.seenPages } : {}
  };
}

function updateWord(profile: UserProfile, word: string, updater: (state: WordState) => WordState): UserProfile {
  const current = createWordState(profile.words[word]);
  const next = updater(current);
  return {
    ...profile,
    words: {
      ...profile.words,
      [word]: next
    }
  };
}

export function createProfile(level: UserLevel): UserProfile {
  const baseScores: Record<UserLevel, number> = {
    starter: 1.8,
    cet4: 2.6,
    cet6: 3.4,
    graduate: 4.2,
    'ielts-toefl': 5,
    professional: 5.8
  };

  return {
    level,
    levelScore: baseScores[level],
    words: {}
  };
}

export function applyKnownFeedback(profile: UserProfile, word: string, seenAt: number): UserProfile {
  const updated = updateWord(profile, word, (state) => ({
    ...state,
    familiarity: state.familiarity,
    isKnown: true,
    isUnknown: false,
    lastSeenAt: seenAt,
    seenPages: state.seenPages
  }));

  return {
    ...updated,
    levelScore: clampLevelScore(updated.levelScore + LEVEL_DELTA.known)
  };
}

export function applyLookupFeedback(
  profile: UserProfile,
  word: string,
  mode: 'hover' | 'alt',
  seenAt: number
): UserProfile {
  const delta = LEVEL_DELTA[mode];
  const updated = updateWord(profile, word, (state) => ({
    ...state,
    isKnown: false,
    isUnknown: true,
    lastSeenAt: seenAt,
    seenPages: state.seenPages
  }));

  return {
    ...updated,
    levelScore: clampLevelScore(updated.levelScore + delta)
  };
}

export function applySkipFeedback(profile: UserProfile, word: string, pageKey: string, seenAt: number): UserProfile {
  const updated = updateWord(profile, word, (state) => {
    if (state.seenPages[pageKey]) {
      return {
        ...state,
        lastSeenAt: seenAt
      };
    }

    return {
      ...state,
      familiarity: state.familiarity + 1,
      lastSeenAt: seenAt,
      seenPages: {
        ...state.seenPages,
        [pageKey]: true
      }
    };
  });

  return updated;
}

export function shouldStopAnnotating(state: WordState | undefined): boolean {
  return Boolean(state?.isKnown) || Boolean(state && state.familiarity >= SKIP_FAMILIARITY_LIMIT);
}
