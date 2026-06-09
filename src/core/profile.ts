import type {
  LookupFeedbackMode,
  LookupTrigger,
  ManualShortcut,
  FeedbackSettings,
  SuppressionMode,
  UnderlineTone,
  UserLevel,
  UserProfile,
  WordState
} from './types';
import { DEFAULT_OFFLINE_DICTIONARY_TIER, normalizeOfflineDictionaryTier } from './dictionaryPacks';

const MIN_LEVEL = 1;
const MAX_LEVEL = 6;
const LEVEL_DELTA = {
  known: 0.18,
  hover: -0.04,
  click: -0.04,
  selection: -0.14
} as const;
export const DEFAULT_ANNOTATION_DENSITY = 1;
export const MIN_ANNOTATION_DENSITY = 0.75;
export const MAX_ANNOTATION_DENSITY = 1.25;

export const DEFAULT_FEEDBACK_SETTINGS: FeedbackSettings = {
  skipLimit: 3,
  skipDelayMs: 3500,
  decayHalfLifeDays: 30,
  suppressionMode: 'balanced'
};

export const SUPPRESSION_MODE_SETTINGS: Record<SuppressionMode, FeedbackSettings> = {
  conservative: {
    skipLimit: 5,
    skipDelayMs: 5000,
    decayHalfLifeDays: 45,
    suppressionMode: 'conservative'
  },
  balanced: DEFAULT_FEEDBACK_SETTINGS,
  aggressive: {
    skipLimit: 2,
    skipDelayMs: 2500,
    decayHalfLifeDays: 21,
    suppressionMode: 'aggressive'
  }
};

function isSuppressionMode(value: unknown): value is SuppressionMode {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive';
}

function positiveNumberOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 将标注密度限制在产品支持的安全范围内。
 *
 * @param value 从存储或 UI 传入的密度值。
 * @returns 0.75 到 1.25 之间的密度值。
 */
export function normalizeAnnotationDensity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ANNOTATION_DENSITY;
  }

  return Math.min(MAX_ANNOTATION_DENSITY, Math.max(MIN_ANNOTATION_DENSITY, Number(value.toFixed(2))));
}

/**
 * 规范化可选时间戳，避免损坏的存储数据影响引导展示。
 *
 * @param value 从存储读取的原始时间戳。
 * @returns 有效时间戳或 undefined。
 */
function normalizeOptionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeFeedbackSettings(settings: Partial<FeedbackSettings> | undefined): FeedbackSettings {
  const suppressionMode = isSuppressionMode(settings?.suppressionMode)
    ? settings.suppressionMode
    : DEFAULT_FEEDBACK_SETTINGS.suppressionMode;
  const fallback = SUPPRESSION_MODE_SETTINGS[suppressionMode];

  return {
    skipLimit: positiveNumberOrFallback(settings?.skipLimit, fallback.skipLimit),
    skipDelayMs: positiveNumberOrFallback(settings?.skipDelayMs, fallback.skipDelayMs),
    decayHalfLifeDays: positiveNumberOrFallback(settings?.decayHalfLifeDays, fallback.decayHalfLifeDays),
    suppressionMode
  };
}

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
    alwaysAnnotate: previous?.alwaysAnnotate ?? false,
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
    annotationDensity: DEFAULT_ANNOTATION_DENSITY,
    offlineDictionaryTier: DEFAULT_OFFLINE_DICTIONARY_TIER,
    feedbackSettings: DEFAULT_FEEDBACK_SETTINGS,
    words: {}
  };
}

/**
 * Normalizes persisted profile data so older installations receive new settings.
 *
 * @param profile - Profile loaded from browser storage.
 * @returns A profile with all current fields populated.
 */
export function normalizeProfile(profile: Partial<UserProfile>): UserProfile {
  const level = profile.level ?? 'cet4';
  const fallback = createProfile(level);
  return {
    ...fallback,
    ...profile,
    level,
    levelScore: typeof profile.levelScore === 'number' ? profile.levelScore : fallback.levelScore,
    underlineTone: profile.underlineTone ?? fallback.underlineTone,
    lookupTrigger: profile.lookupTrigger ?? fallback.lookupTrigger,
    manualShortcut: profile.manualShortcut ?? fallback.manualShortcut,
    annotationDensity: normalizeAnnotationDensity(profile.annotationDensity),
    offlineDictionaryTier: normalizeOfflineDictionaryTier(profile.offlineDictionaryTier),
    onboardingDismissedAt: normalizeOptionalTimestamp(profile.onboardingDismissedAt),
    feedbackSettings: normalizeFeedbackSettings(profile.feedbackSettings),
    words: profile.words ?? {}
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
    alwaysAnnotate: false,
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

export function resetSkipFeedback(profile: UserProfile, word: string): UserProfile {
  const state = profile.words[word];
  if (!state) {
    return profile;
  }

  return {
    ...profile,
    words: {
      ...profile.words,
      [word]: {
        ...state,
        familiarity: 0,
        seenPages: {}
      }
    }
  };
}

/**
 * Pins a word so weak skip feedback no longer hides it from annotation.
 *
 * @param profile User profile to update.
 * @param word Word the user wants to keep seeing.
 * @param seenAt Time of the explicit user action.
 * @returns Updated profile with weak feedback cleared for that word.
 */
export function markWordAlwaysAnnotate(profile: UserProfile, word: string, seenAt: number): UserProfile {
  return updateWord(profile, word, (state) => ({
    ...state,
    familiarity: 0,
    isKnown: false,
    alwaysAnnotate: true,
    lastSeenAt: seenAt,
    seenPages: {}
  }));
}

/**
 * Removes the explicit always-annotate preference for a word.
 *
 * @param profile User profile to update.
 * @param word Word that should return to automatic annotation decisions.
 * @returns Updated profile with the pin removed.
 */
export function unmarkWordAlwaysAnnotate(profile: UserProfile, word: string): UserProfile {
  const state = profile.words[word];
  if (!state) {
    return profile;
  }

  return {
    ...profile,
    words: {
      ...profile.words,
      [word]: {
        ...state,
        alwaysAnnotate: false
      }
    }
  };
}

export function resetAllSkipFeedback(profile: UserProfile): UserProfile {
  const words = Object.fromEntries(
    Object.entries(profile.words).map(([word, state]) => [
      word,
      {
        ...state,
        familiarity: 0,
        seenPages: {}
      }
    ])
  );

  return {
    ...profile,
    words
  };
}

export function shouldStopAnnotating(
  state: WordState | undefined,
  settings: Pick<FeedbackSettings, 'skipLimit'> = DEFAULT_FEEDBACK_SETTINGS
): boolean {
  if (!state) {
    return false;
  }

  if (state.isKnown) {
    return true;
  }

  if (state.alwaysAnnotate) {
    return false;
  }

  return state.familiarity >= settings.skipLimit;
}
