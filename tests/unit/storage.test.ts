import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { upsertVocabItem } from '../../src/storage/vocabStore';

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
});
