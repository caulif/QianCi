import type { KeyValueStore } from './browserAdapter';

export interface VocabItem {
  word: string;
  translation: string;
  lastSeenAt: number;
  lookupCount: number;
}

const VOCAB_KEY = 'qianci.vocab';

export async function loadVocab(store: KeyValueStore): Promise<VocabItem[]> {
  const items = await store.get<{ [VOCAB_KEY]?: VocabItem[] }>([VOCAB_KEY]);
  return items[VOCAB_KEY] ?? [];
}

export async function saveVocab(store: KeyValueStore, vocab: VocabItem[]): Promise<void> {
  await store.set({ [VOCAB_KEY]: vocab });
}

export function upsertVocabItem(vocab: VocabItem[], next: VocabItem): VocabItem[] {
  const existing = vocab.find((item) => item.word === next.word);
  if (!existing) {
    return [next, ...vocab];
  }

  return [
    {
      ...existing,
      translation: next.translation,
      lastSeenAt: next.lastSeenAt,
      lookupCount: existing.lookupCount + next.lookupCount
    },
    ...vocab.filter((item) => item.word !== next.word)
  ];
}

export function removeVocabItem(vocab: VocabItem[], word: string): VocabItem[] {
  return vocab.filter((item) => item.word !== word);
}
