import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { KeyValueStore } from './browserAdapter';

const CUSTOM_DICTIONARY_KEY = 'qianci.customDictionary';

export type CustomDictionary = Record<string, DictionaryEntry>;

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export async function loadCustomDictionary(store: KeyValueStore): Promise<CustomDictionary> {
  const items = await store.get<{ [CUSTOM_DICTIONARY_KEY]?: CustomDictionary }>([CUSTOM_DICTIONARY_KEY]);
  return items[CUSTOM_DICTIONARY_KEY] ?? {};
}

export async function saveCustomDictionary(store: KeyValueStore, dictionary: CustomDictionary): Promise<void> {
  await store.set({ [CUSTOM_DICTIONARY_KEY]: dictionary });
}

export function upsertCustomDictionary(dictionary: CustomDictionary, entry: DictionaryEntry): CustomDictionary {
  const word = normalizeWord(entry.word);
  return {
    ...dictionary,
    [word]: {
      ...entry,
      word,
      source: entry.source ?? 'custom'
    }
  };
}
