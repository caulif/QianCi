import sampleDictionary from '../data/sample-dictionary.json';
import { createContentApp } from './app';
import { createChromeStorageAdapter } from '../storage/browserAdapter';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { createProfile } from '../core/profile';
import type { UserProfile } from '../core/types';
import { loadVocab, saveVocab, upsertVocabItem } from '../storage/vocabStore';

async function bootstrap(): Promise<void> {
  const store = createChromeStorageAdapter(chrome.storage.local);
  const profile = (await loadProfile(store)) ?? createProfile('cet4');
  const recordVocab = async (word: string) => {
    const entry = sampleDictionary[word as keyof typeof sampleDictionary];
    if (!entry) {
      return;
    }
    const vocab = await loadVocab(store);
    await saveVocab(
      store,
      upsertVocabItem(vocab, {
        word,
        translation: entry.translation,
        lastSeenAt: Date.now(),
        lookupCount: 1
      })
    );
  };

  const app = createContentApp(document, {
    profile,
    dictionary: sampleDictionary,
    onKnown: async (_word: string, nextProfile: UserProfile) => {
      await saveProfile(store, nextProfile);
    },
    onLookup: async (_word: string, _mode: 'hover' | 'alt', nextProfile: UserProfile) => {
      await saveProfile(store, nextProfile);
      await recordVocab(_word);
    },
    onSkip: async (_word: string, _pageKey: string, nextProfile: UserProfile) => {
      await saveProfile(store, nextProfile);
    }
  });

  app.rescan();
}

void bootstrap();
