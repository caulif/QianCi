import rankIndex from '../data/rank.generated.json';
import { isLookupSelectionMessage, ONLINE_LOOKUP_MESSAGE_TYPE, type OnlineLookupResult } from '../core/messages';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import { createContentApp } from './app';
import { createLazyDictionaryResolver, type RuntimeDictionaryPack } from './dictionary';
import { createChromeStorageAdapter } from '../storage/browserAdapter';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { createProfile } from '../core/profile';
import type { LookupFeedbackMode, UserProfile } from '../core/types';
import {
  loadCustomDictionary,
  saveCustomDictionary,
  upsertCustomDictionary,
  type CustomDictionary
} from '../storage/customDictionaryStore';
import { loadVocab, removeVocabItem, saveVocab, upsertVocabItem } from '../storage/vocabStore';

async function bootstrap(): Promise<void> {
  const store = createChromeStorageAdapter(chrome.storage.local);
  let profile = (await loadProfile(store)) ?? createProfile('cet4');
  let customDictionary: CustomDictionary = await loadCustomDictionary(store);
  const dictionaryUrl = new URL('../data/dictionary.generated.json', import.meta.url).href;
  const bundledDictionary = createLazyDictionaryResolver(async () => {
    const response = await fetch(dictionaryUrl);
    if (!response.ok) {
      throw new Error(`Failed to load dictionary pack: ${response.status}`);
    }
    return (await response.json()) as RuntimeDictionaryPack;
  });

  const resolveEntry = async (word: string): Promise<DictionaryEntry | undefined> => {
    const normalized = word.trim().toLowerCase();
    return customDictionary[normalized] ?? (await bundledDictionary.resolveEntry(normalized));
  };

  const syncVocab = async (word: string, entry?: DictionaryEntry, nextProfile?: UserProfile) => {
    const normalized = word.trim().toLowerCase();
    const currentProfile = nextProfile ?? profile;
    const vocab = await loadVocab(store);
    if (currentProfile.words[normalized]?.isKnown) {
      await saveVocab(store, removeVocabItem(vocab, normalized));
      return;
    }

    if (!entry) {
      return;
    }

    await saveVocab(
      store,
      upsertVocabItem(vocab, {
        word: normalized,
        translation: entry.translation,
        lastSeenAt: Date.now(),
        lookupCount: 1
      })
    );
  };

  const lookupOnline = async (word: string): Promise<OnlineLookupResult> => {
    const response = (await chrome.runtime.sendMessage({
      type: ONLINE_LOOKUP_MESSAGE_TYPE,
      word
    })) as OnlineLookupResult;

    if (response.ok && response.entry) {
      customDictionary = upsertCustomDictionary(customDictionary, response.entry);
      await saveCustomDictionary(store, customDictionary);
    }

    return response;
  };

  const app = createContentApp(document, {
    profile,
    ranks: rankIndex,
    resolveEntry,
    lookupOnline,
    onKnown: async (_word: string, nextProfile: UserProfile) => {
      profile = nextProfile;
      await saveProfile(store, nextProfile);
      await syncVocab(_word, undefined, nextProfile);
    },
    onLookup: async (word: string, _mode: LookupFeedbackMode, nextProfile: UserProfile, entry?: DictionaryEntry) => {
      profile = nextProfile;
      await saveProfile(store, nextProfile);
      await syncVocab(word, entry, nextProfile);
    },
    onSkip: async (_word: string, _pageKey: string, nextProfile: UserProfile) => {
      profile = nextProfile;
      await saveProfile(store, nextProfile);
    }
  });

  app.rescan();

  chrome.runtime.onMessage.addListener((message) => {
    if (!isLookupSelectionMessage(message)) {
      return;
    }

    void app.lookupSelection(message.text, 'menu');
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes['qianci.profile']?.newValue) {
      profile = changes['qianci.profile'].newValue as UserProfile;
      app.updateProfile(profile);
    }

    if (changes['qianci.customDictionary']?.newValue) {
      customDictionary = changes['qianci.customDictionary'].newValue as CustomDictionary;
    }
  });
}

void bootstrap();
