import type { UserProfile } from '../core/types';

export interface ProfilePersistenceQueue {
  enqueue(profile: UserProfile, afterSave?: () => Promise<void>): Promise<void>;
}

/**
 * Creates a serial profile persistence queue for fire-and-forget content callbacks.
 *
 * @param saveProfile Function that persists one profile snapshot.
 * @returns Queue that preserves enqueue order and keeps working after failures.
 */
export function createProfilePersistenceQueue(
  saveProfile: (profile: UserProfile) => Promise<void>
): ProfilePersistenceQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue(profile, afterSave) {
      const write = tail.then(async () => {
        await saveProfile(profile);
        await afterSave?.();
      });
      tail = write.catch(() => undefined);
      return write;
    }
  };
}
