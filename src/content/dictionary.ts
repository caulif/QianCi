import type { DictionaryEntry } from '../core/dictionaryEntry';

export interface RuntimeDictionaryPack {
  dictionary: Record<string, DictionaryEntry>;
  lemma: Record<string, string[]>;
}

export interface DictionaryResolver {
  resolveEntry(word: string): Promise<DictionaryEntry | undefined>;
}

export function createLazyDictionaryResolver(
  loadPack: () => Promise<RuntimeDictionaryPack>
): DictionaryResolver {
  let packPromise: Promise<RuntimeDictionaryPack> | null = null;

  async function getPack(): Promise<RuntimeDictionaryPack> {
    packPromise ??= loadPack();
    return packPromise;
  }

  return {
    async resolveEntry(word: string): Promise<DictionaryEntry | undefined> {
      const normalized = word.trim().toLowerCase();
      if (!normalized) {
        return undefined;
      }

      const pack = await getPack();
      const exact = pack.dictionary[normalized];
      if (exact) {
        return exact;
      }

      const lemmas = pack.lemma[normalized] ?? [];
      for (const lemma of lemmas) {
        const entry = pack.dictionary[lemma];
        if (entry) {
          return entry;
        }
      }

      return undefined;
    }
  };
}
