export type UserLevel =
  | 'starter'
  | 'cet4'
  | 'cet6'
  | 'graduate'
  | 'ielts-toefl'
  | 'professional';

export type UnderlineTone = 'graphite' | 'sky' | 'sage' | 'amber' | 'rose';
export type LookupTrigger = 'hover' | 'click';
export type ManualShortcut = 'alt' | 'ctrl' | 'shift' | 'meta';
export type LookupFeedbackMode = 'hover' | 'click' | 'selection';
export type SuppressionMode = 'conservative' | 'balanced' | 'aggressive';
export type SiteMode = 'auto' | 'manual-only' | 'paused';
export type OfflineDictionaryTier = 'core' | 'extended' | 'deep' | 'full';

export interface SitePolicy {
  mode: SiteMode;
  updatedAt: number;
}

export type SitePolicies = Record<string, SitePolicy>;

export interface FeedbackSettings {
  skipLimit: number;
  skipDelayMs: number;
  decayHalfLifeDays: number;
  suppressionMode: SuppressionMode;
}

export interface WordState {
  familiarity: number;
  isKnown: boolean;
  isUnknown: boolean;
  alwaysAnnotate?: boolean;
  lastSeenAt: number;
  seenPages: Record<string, true>;
}

export interface UserProfile {
  level: UserLevel;
  levelScore: number;
  underlineTone: UnderlineTone;
  lookupTrigger: LookupTrigger;
  manualShortcut: ManualShortcut;
  annotationDensity: number;
  offlineDictionaryTier: OfflineDictionaryTier;
  onboardingDismissedAt?: number;
  feedbackSettings: FeedbackSettings;
  words: Record<string, WordState>;
}

export interface WordCandidate {
  word: string;
  rank: number | undefined;
}
