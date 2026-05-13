import { createProfile } from '../core/profile';
import type { UserProfile } from '../core/types';
import type { KeyValueStore } from './browserAdapter';

const PROFILE_KEY = 'qianci.profile';

function normalizeProfile(profile: UserProfile): UserProfile {
  const fallback = createProfile(profile.level ?? 'cet4');
  return {
    ...profile,
    level: profile.level ?? fallback.level,
    levelScore: typeof profile.levelScore === 'number' ? profile.levelScore : fallback.levelScore,
    underlineTone: profile.underlineTone ?? fallback.underlineTone,
    lookupTrigger: profile.lookupTrigger ?? fallback.lookupTrigger,
    manualShortcut: profile.manualShortcut ?? fallback.manualShortcut,
    words: profile.words ?? {}
  };
}

export async function loadProfile(store: KeyValueStore): Promise<UserProfile | null> {
  const items = await store.get<{ [PROFILE_KEY]?: UserProfile }>([PROFILE_KEY]);
  const profile = items[PROFILE_KEY];
  return profile ? normalizeProfile(profile) : null;
}

export async function saveProfile(store: KeyValueStore, profile: UserProfile): Promise<void> {
  await store.set({ [PROFILE_KEY]: normalizeProfile(profile) });
}
