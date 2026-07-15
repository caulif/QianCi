import type { OnlineLookupErrorKind, PageDiagnostics } from '../core/messages';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { LookupFeedbackMode, SiteMode, SitePolicy, UserProfile } from '../core/types';

export interface ContentServices {
  profile: UserProfile;
  ranks: Record<string, number>;
  resolveEntry(word: string): Promise<DictionaryEntry | undefined>;
  lookupOnline(word: string): Promise<{
    entry?: DictionaryEntry;
    message: string;
    errorKind?: OnlineLookupErrorKind;
    queued?: boolean;
  }>;
  siteMode?: SiteMode;
  sitePolicy?: SitePolicy;
  isTopFrame?: boolean;
  onKnown(word: string, profile: UserProfile): void | Promise<void>;
  onUndoKnown?(word: string, profile: UserProfile, entry?: DictionaryEntry): void | Promise<void>;
  onLookup(word: string, mode: LookupFeedbackMode, profile: UserProfile, entry?: DictionaryEntry): void | Promise<void>;
  onSkip(word: string, pageKey: string, profile: UserProfile): void | Promise<void>;
  onAlwaysAnnotate?(word: string, profile: UserProfile): void | Promise<void>;
  onUndoAlwaysAnnotate?(word: string, profile: UserProfile): void | Promise<void>;
  onTranslationFeedback?(word: string, entry: DictionaryEntry, translation?: string): void | Promise<void>;
}

export interface ContentApp {
  rescan(): void;
  updateProfile(profile: UserProfile): void;
  updateSiteMode(mode: SiteMode): void;
  updateSitePolicy?(policy: SitePolicy | undefined): void;
  getDiagnostics(): PageDiagnostics;
  lookupSelection(selectionText: string, source?: 'alt' | 'menu'): Promise<void>;
  dispose(): void;
}
