import type {
  LookupFeedbackMode,
  LookupTrigger,
  ManualShortcut,
  UnderlineTone,
  UserLevel,
  UserProfile,
  WordState
} from './types';

const MIN_LEVEL = 1;
const MAX_LEVEL = 6;
const SKIP_FAMILIARITY_LIMIT = 3;
const LEVEL_DELTA = {
  known: 0.18,
  hover: -0.04,
  click: -0.04,
  selection: -0.14
} as const;

const BASE_LEVEL_SCORES: Record<UserLevel, number> = {
  starter: 1.8,
  cet4: 2.6,
  cet6: 3.4,
  graduate: 4.2,
  'ielts-toefl': 5,
  professional: 5.8
};

export const UNDERLINE_TONES: Array<{ tone: UnderlineTone; label: string; color: string }> = [
  { tone: 'graphite', label: '石墨灰', color: '#6b7280' },
  { tone: 'sky', label: '雾蓝', color: '#5f7db9' },
  { tone: 'sage', label: '鼠尾草', color: '#5f7b66' },
  { tone: 'amber', label: '琥珀', color: '#9a6c35' },
  { tone: 'rose', label: '豆沙', color: '#ab6672' }
];

export const LOOKUP_TRIGGERS: Array<{ trigger: LookupTrigger; label: string }> = [
  { trigger: 'hover', label: '悬停' },
  { trigger: 'click', label: '点击' }
];

export const MANUAL_SHORTCUTS: Array<{ key: ManualShortcut; label: string }> = [
  { key: 'alt', label: 'Alt' },
  { key: 'ctrl', label: 'Ctrl' },
  { key: 'shift', label: 'Shift' },
  { key: 'meta', label: 'Cmd/Win' }
];

export function underlineToneColor(tone: UnderlineTone): string {
  return UNDERLINE_TONES.find((item) => item.tone === tone)?.color ?? UNDERLINE_TONES[0].color;
}

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
  return {
    level,
    levelScore: BASE_LEVEL_SCORES[level],
    underlineTone: 'graphite',
    lookupTrigger: 'hover',
    manualShortcut: 'alt',
    words: {}
  };
}

export function getBaseLevelScore(level: UserLevel): number {
  return BASE_LEVEL_SCORES[level];
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
  mode: LookupFeedbackMode,
  seenAt: number
): UserProfile {
  const delta = LEVEL_DELTA[mode];
  const updated = updateWord(profile, word, (state) => ({
    ...state,
    isKnown: state.isKnown,
    isUnknown: state.isKnown ? false : true,
    lastSeenAt: seenAt,
    seenPages: state.seenPages
  }));

  return {
    ...updated,
    levelScore: stateIsKnown(profile, word) ? updated.levelScore : clampLevelScore(updated.levelScore + delta)
  };
}

function stateIsKnown(profile: UserProfile, word: string): boolean {
  return Boolean(profile.words[word]?.isKnown);
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
