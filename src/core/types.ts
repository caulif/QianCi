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
export type SiteMode = 'auto' | 'manual-only' | 'paused' | 'low-density' | 'safe';
export type OfflineDictionaryTier = 'core' | 'extended' | 'deep' | 'full';

export interface SitePolicy {
  mode: SiteMode;
  /** 站点级 CSS 排除选择器，与全局跳过规则叠加。 */
  excludeSelectors?: string[];
  /** 是否允许在本站同源 iframe 中启动 content app。 */
  allowSameOriginFrames?: boolean;
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
  /** 是否允许用户主动联网补查；默认 true。 */
  onlineLookupEnabled?: boolean;
  onboardingDismissedAt?: number;
  feedbackSettings: FeedbackSettings;
  words: Record<string, WordState>;
}

export interface WordCandidate {
  word: string;
  rank: number | undefined;
}
