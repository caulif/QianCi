export type UserLevel =
  | 'starter'
  | 'cet4'
  | 'cet6'
  | 'graduate'
  | 'ielts-toefl'
  | 'professional';

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
  words: Record<string, WordState>;
}

export interface WordCandidate {
  word: string;
  rank: number | undefined;
}
