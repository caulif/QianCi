import type { UserProfile } from '../core/types';
import type { KeyValueStore } from './browserAdapter';

const PROFILE_KEY = 'qianci.profile';

export async function loadProfile(store: KeyValueStore): Promise<UserProfile | null> {
  const items = await store.get<{ [PROFILE_KEY]?: UserProfile }>([PROFILE_KEY]);
  return items[PROFILE_KEY] ?? null;
}

export async function saveProfile(store: KeyValueStore, profile: UserProfile): Promise<void> {
  await store.set({ [PROFILE_KEY]: profile });
}
