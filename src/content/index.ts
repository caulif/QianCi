import {
  isLookupSelectionMessage,
  isPageDiagnosticsMessage,
  isRescanPageMessage,
  ONLINE_LOOKUP_MESSAGE_TYPE,
  type OnlineLookupResult
} from '../core/messages';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import { createContentApp } from './app';
import { createTieredDictionaryResolver, type RuntimeDictionaryPack } from './dictionary';
import { createChromeStorageAdapter } from '../storage/browserAdapter';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { createProfile, isOnlineLookupEnabled, preferClickTriggerForPointer } from '../core/profile';
import type { LookupFeedbackMode, UserProfile } from '../core/types';
import { getSiteModeForUrl, getSitePolicyForUrl } from '../core/sitePolicy';
import type { SitePolicy } from '../core/types';
import { OFFLINE_DICTIONARY_PACK_OPTIONS, normalizeOfflineDictionaryTier } from '../core/dictionaryPacks';
import {
  loadCustomDictionary,
  resolveEntryWithPriority,
  saveCustomDictionary,
  upsertCustomDictionary,
  upsertOnlineDictionaryEntry,
  type CustomDictionary
} from '../storage/customDictionaryStore';
import { loadVocab, removeVocabItem, saveVocab, upsertVocabItem } from '../storage/vocabStore';
import { loadSitePolicies, normalizeSitePolicies, SITE_POLICIES_KEY } from '../storage/sitePolicyStore';
import { createProfilePersistenceQueue } from './profilePersistenceQueue';
import { resolvePolicyUrl, shouldBootstrapContentFrame } from './framePolicy';

type RuntimeRankIndex = Record<string, number>;

async function bootstrap(): Promise<void> {
  const store = createChromeStorageAdapter(chrome.storage.local);
  let sitePolicies = await loadSitePolicies(store);
  const policyUrl = resolvePolicyUrl(window);
  let sitePolicy: SitePolicy | undefined = getSitePolicyForUrl(sitePolicies, policyUrl);
  const isTopFrame = window.self === window.top;

  if (
    !shouldBootstrapContentFrame(window, {
      allowSameOriginFrames: Boolean(sitePolicy?.allowSameOriginFrames)
    })
  ) {
    return;
  }

  let profile = (await loadProfile(store)) ?? createProfile('cet4');
  try {
    const hoverNone =
      typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    const nextProfile = preferClickTriggerForPointer(profile, { hoverNone });
    if (nextProfile.lookupTrigger !== profile.lookupTrigger) {
      profile = nextProfile;
      await saveProfile(store, profile);
    }
  } catch {
    // matchMedia 不可用时保持原触发方式
  }
  let customDictionary: CustomDictionary = await loadCustomDictionary(store);
  let siteMode = sitePolicy?.mode ?? getSiteModeForUrl(sitePolicies, policyUrl);
  const profilePersistence = createProfilePersistenceQueue(async (nextProfile) => {
    await saveProfile(store, nextProfile);
  });
  const dictionaryUrls = {
    core: new URL('../data/dictionary.core.generated.json', import.meta.url).href,
    extended: new URL('../data/dictionary.extended.generated.json', import.meta.url).href,
    deep: new URL('../data/dictionary.deep.generated.json', import.meta.url).href,
    full: new URL('../data/dictionary.full.generated.json', import.meta.url).href
  } as const;
  const rankIndexUrl = new URL('../data/rank.generated.json', import.meta.url).href;
  const rankResponse = await fetch(rankIndexUrl);
  if (!rankResponse.ok) {
    throw new Error(`Failed to load rank index: ${rankResponse.status}`);
  }
  const ranks = (await rankResponse.json()) as RuntimeRankIndex;
  const bundledDictionary = createTieredDictionaryResolver(
    OFFLINE_DICTIONARY_PACK_OPTIONS.map((option) => ({
      tier: option.tier,
      loadPack: async () => {
        const response = await fetch(dictionaryUrls[option.tier]);
        if (!response.ok) {
          throw new Error(`Failed to load dictionary ${option.tier} pack: ${response.status}`);
        }
        return (await response.json()) as RuntimeDictionaryPack;
      }
    })),
    () => normalizeOfflineDictionaryTier(profile.offlineDictionaryTier)
  );

  const resolveEntry = async (word: string): Promise<DictionaryEntry | undefined> => {
    const normalized = word.trim().toLowerCase();
    const bundled = await bundledDictionary.resolveEntry(normalized);
    return resolveEntryWithPriority(customDictionary, normalized, bundled);
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
    if (!isOnlineLookupEnabled(profile)) {
      return {
        ok: false,
        message: '已关闭联网补查',
        errorKind: 'service_unavailable'
      };
    }

    const response = (await chrome.runtime.sendMessage({
      type: ONLINE_LOOKUP_MESSAGE_TYPE,
      word
    })) as OnlineLookupResult;

    if (response.ok && response.entry) {
      customDictionary = upsertOnlineDictionaryEntry(customDictionary, response.entry);
      await saveCustomDictionary(store, customDictionary);
    }

    return response;
  };

  const persistProfile = async (nextProfile: UserProfile, afterSave?: () => Promise<void>): Promise<void> => {
    profile = nextProfile;
    await profilePersistence.enqueue(nextProfile, afterSave);
  };

  const app = createContentApp(document, {
    profile,
    siteMode,
    sitePolicy,
    isTopFrame,
    ranks,
    resolveEntry,
    lookupOnline,
    onKnown: async (_word: string, nextProfile: UserProfile) => {
      await persistProfile(nextProfile, async () => {
        await syncVocab(_word, undefined, nextProfile);
      });
    },
    onUndoKnown: async (word: string, nextProfile: UserProfile, entry?: DictionaryEntry) => {
      await persistProfile(nextProfile, async () => {
        await syncVocab(word, entry, nextProfile);
      });
    },
    onLookup: async (word: string, _mode: LookupFeedbackMode, nextProfile: UserProfile, entry?: DictionaryEntry) => {
      await persistProfile(nextProfile, async () => {
        await syncVocab(word, entry, nextProfile);
      });
    },
    onSkip: async (_word: string, _pageKey: string, nextProfile: UserProfile) => {
      await persistProfile(nextProfile);
    },
    onAlwaysAnnotate: async (_word: string, nextProfile: UserProfile) => {
      await persistProfile(nextProfile);
    },
    onUndoAlwaysAnnotate: async (_word: string, nextProfile: UserProfile) => {
      await persistProfile(nextProfile);
    },
    onTranslationFeedback: async (word: string, entry: DictionaryEntry, translation?: string) => {
      customDictionary = upsertCustomDictionary(customDictionary, {
        ...entry,
        word,
        translation: translation?.trim() || entry.translation,
        source: 'custom'
      });
      await saveCustomDictionary(store, customDictionary);
    }
  });

  if (siteMode === 'auto' || siteMode === 'low-density' || siteMode === 'safe') {
    app.rescan();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isLookupSelectionMessage(message)) {
      void app.lookupSelection(message.text, 'menu');
      return;
    }

    if (isPageDiagnosticsMessage(message)) {
      sendResponse(app.getDiagnostics());
      return;
    }

    if (isRescanPageMessage(message)) {
      app.rescan();
      sendResponse(app.getDiagnostics());
    }
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

    if (changes[SITE_POLICIES_KEY]) {
      sitePolicies = normalizeSitePolicies(changes[SITE_POLICIES_KEY].newValue);
      sitePolicy = getSitePolicyForUrl(sitePolicies, policyUrl);
      siteMode = sitePolicy?.mode ?? getSiteModeForUrl(sitePolicies, policyUrl);
      if (app.updateSitePolicy) {
        app.updateSitePolicy(sitePolicy);
      } else {
        app.updateSiteMode(siteMode);
      }
    }
  });
}

void bootstrap();
