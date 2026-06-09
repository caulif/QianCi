import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { OfflineDictionaryTier } from '../core/types';
import { offlineDictionaryTiersUpTo } from '../core/dictionaryPacks';

export interface RuntimeDictionaryPack {
  dictionary: Record<string, DictionaryEntry>;
  lemma: Record<string, string[]>;
}

export interface DictionaryResolver {
  resolveEntry(word: string): Promise<DictionaryEntry | undefined>;
}

export interface TieredDictionaryPackLoader {
  tier: OfflineDictionaryTier;
  loadPack: () => Promise<RuntimeDictionaryPack>;
}

function resolveFromPack(pack: RuntimeDictionaryPack, normalized: string): DictionaryEntry | undefined {
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
      return resolveFromPack(pack, normalized);
    }
  };
}

export function createTieredDictionaryResolver(
  loaders: TieredDictionaryPackLoader[],
  selectedTier: OfflineDictionaryTier | (() => OfflineDictionaryTier)
): DictionaryResolver {
  const loaderByTier = new Map(loaders.map((loader) => [loader.tier, loader.loadPack]));
  const packPromises = new Map<OfflineDictionaryTier, Promise<RuntimeDictionaryPack>>();
  const enabledTiers = (): OfflineDictionaryTier[] =>
    offlineDictionaryTiersUpTo(typeof selectedTier === 'function' ? selectedTier() : selectedTier);

  async function loadTier(tier: OfflineDictionaryTier): Promise<RuntimeDictionaryPack | undefined> {
    const loadPack = loaderByTier.get(tier);
    if (!loadPack) {
      return undefined;
    }

    let packPromise = packPromises.get(tier);
    if (!packPromise) {
      packPromise = loadPack();
      packPromises.set(tier, packPromise);
    }
    return packPromise;
  }

  return {
    async resolveEntry(word: string): Promise<DictionaryEntry | undefined> {
      const normalized = word.trim().toLowerCase();
      if (!normalized) {
        return undefined;
      }

      for (const tier of enabledTiers()) {
        const pack = await loadTier(tier);
        if (!pack) {
          continue;
        }

        const entry = resolveFromPack(pack, normalized);
        if (entry) {
          return entry;
        }
      }

      return undefined;
    }
  };
}
