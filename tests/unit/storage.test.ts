import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { loadProfile } from '../../src/storage/profileStore';
import { removeVocabItem, upsertVocabItem } from '../../src/storage/vocabStore';
import { createProfile } from '../../src/core/profile';
import { loadCustomDictionary, upsertCustomDictionary } from '../../src/storage/customDictionaryStore';

describe('storage adapter', () => {
  it('persists and clears values in the memory store', async () => {
    const store = createMemoryStore();

    await store.set({
      level: 'cet4',
      vocab: [{ word: 'abrupt', translation: '突然的' }]
    });

    const current = await store.get<{ level?: string; vocab?: Array<{ word: string; translation: string }> }>(['level', 'vocab']);
    expect(current.level).toBe('cet4');
    expect(current.vocab ?? []).toHaveLength(1);
    expect(current.vocab?.[0].word).toBe('abrupt');

    await store.remove(['level']);
    const afterRemove = await store.get<{ level?: string; vocab?: Array<{ word: string; translation: string }> }>(['level', 'vocab']);
    expect(afterRemove.level).toBeUndefined();
    expect(afterRemove.vocab ?? []).toHaveLength(1);

    await store.clear();
    const empty = await store.get<{ level?: string; vocab?: Array<{ word: string; translation: string }> }>(['level', 'vocab']);
    expect(empty.level).toBeUndefined();
    expect(empty.vocab).toBeUndefined();
  });
});

describe('profile store', () => {
  it('backfills newer interaction settings when loading an older profile', async () => {
    const store = createMemoryStore({
      'qianci.profile': {
        ...createProfile('cet4'),
        underlineTone: 'rose'
      }
    });

    const profile = await loadProfile(store);

    expect(profile?.underlineTone).toBe('rose');
    expect(profile?.lookupTrigger).toBe('hover');
    expect(profile?.manualShortcut).toBe('alt');
  });
});

describe('custom dictionary store', () => {
  it('upserts normalized user dictionary entries', async () => {
    const store = createMemoryStore();
    const next = upsertCustomDictionary({}, { word: 'Serendipity', phonetic: '/x/', translation: '意外之喜', rank: 999999 });

    await store.set({ 'qianci.customDictionary': next });
    const dictionary = await loadCustomDictionary(store);

    expect(dictionary.serendipity?.translation).toBe('意外之喜');
    expect(dictionary.serendipity?.source).toBe('custom');
  });
});

describe('vocab store helpers', () => {
  it('upserts looked-up words and increments lookup count', () => {
    const once = upsertVocabItem([], {
      word: 'abrupt',
      translation: '突然的',
      lastSeenAt: 100,
      lookupCount: 1
    });
    const twice = upsertVocabItem(once, {
      word: 'abrupt',
      translation: '突然的；唐突的',
      lastSeenAt: 200,
      lookupCount: 1
    });

    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({
      word: 'abrupt',
      translation: '突然的；唐突的',
      lastSeenAt: 200,
      lookupCount: 2
    });
  });

  it('removes a word from vocab when it becomes known', () => {
    const vocab = removeVocabItem(
      [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 100, lookupCount: 1 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 200, lookupCount: 1 }
      ],
      'abrupt'
    );

    expect(vocab).toHaveLength(1);
    expect(vocab[0].word).toBe('coherence');
  });
});
