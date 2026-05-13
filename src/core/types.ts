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

export interface WordState {
  familiarity: number;
  isKnown: boolean;
  isUnknown: boolean;
  lastSeenAt: number;
  seenPages: Record<string, true>;
}

export interface UserProfile {
  level: UserLevel;
  levelScore: number;
  underlineTone: UnderlineTone;
  lookupTrigger: LookupTrigger;
  manualShortcut: ManualShortcut;
  words: Record<string, WordState>;
}

export interface WordCandidate {
  word: string;
  rank: number | undefined;
}
