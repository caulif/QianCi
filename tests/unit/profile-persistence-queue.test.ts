import { describe, expect, it, vi } from 'vitest';
import { createProfilePersistenceQueue } from '../../src/content/profilePersistenceQueue';
import { createProfile } from '../../src/core/profile';

describe('profile persistence queue', () => {
  it('serializes profile writes so a slow earlier save cannot overwrite a later undo', async () => {
    const savedLevels: string[] = [];
    let releaseFirstSave: (() => void) | undefined;
    const saveProfile = vi.fn(async (profile: ReturnType<typeof createProfile>) => {
      if (profile.level === 'starter') {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      savedLevels.push(profile.level);
    });
    const queue = createProfilePersistenceQueue(saveProfile);

    const firstSave = queue.enqueue(createProfile('starter'));
    const undoSave = queue.enqueue(createProfile('cet4'));

    await Promise.resolve();
    expect(savedLevels).toEqual([]);

    releaseFirstSave?.();
    await Promise.all([firstSave, undoSave]);

    expect(savedLevels).toEqual(['starter', 'cet4']);
    expect(saveProfile).toHaveBeenCalledTimes(2);
  });

  it('keeps accepting later saves after a write fails', async () => {
    const savedLevels: string[] = [];
    const saveProfile = vi.fn(async (profile: ReturnType<typeof createProfile>) => {
      savedLevels.push(profile.level);
    });
    saveProfile
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementationOnce(async (profile: ReturnType<typeof createProfile>) => {
        savedLevels.push(profile.level);
      });
    const queue = createProfilePersistenceQueue(saveProfile);

    await expect(queue.enqueue(createProfile('starter'))).rejects.toThrow('storage unavailable');
    await queue.enqueue(createProfile('cet6'));

    expect(savedLevels).toEqual(['cet6']);
  });

  it('serializes save side effects in the same operation order', async () => {
    const events: string[] = [];
    const queue = createProfilePersistenceQueue(async (profile) => {
      events.push(`save:${profile.level}`);
    });

    await Promise.all([
      queue.enqueue(createProfile('starter'), async () => {
        events.push('sync:starter');
      }),
      queue.enqueue(createProfile('cet4'), async () => {
        events.push('sync:cet4');
      })
    ]);

    expect(events).toEqual(['save:starter', 'sync:starter', 'save:cet4', 'sync:cet4']);
  });
});
