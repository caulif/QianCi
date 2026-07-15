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

/**
 * 写入联网缓存：不得覆盖用户自定义释义（source: custom）。
 *
 * @param dictionary 当前自定义/缓存词典。
 * @param entry 联网成功词条。
 * @returns 更新后的词典；若已有 custom 则原样返回。
 */
export function upsertOnlineDictionaryEntry(
  dictionary: CustomDictionary,
  entry: DictionaryEntry
): CustomDictionary {
  const word = normalizeWord(entry.word);
  const existing = dictionary[word];
  if (existing?.source === 'custom') {
    return dictionary;
  }

  return upsertCustomDictionary(dictionary, {
    ...entry,
    word,
    source: 'online'
  });
}

/**
 * 解析优先级：custom 与 online 缓存（同 store）优先于离线包。
 * custom / online 同 key 只存一份；写入侧保证 custom 不被 online 覆盖。
 *
 * @param customDictionary 用户自定义 + 联网缓存。
 * @param word 规范化单词。
 * @param bundled 离线包命中结果。
 */
export function resolveEntryWithPriority(
  customDictionary: CustomDictionary,
  word: string,
  bundled: DictionaryEntry | undefined
): DictionaryEntry | undefined {
  const normalized = normalizeWord(word);
  if (!normalized) {
    return undefined;
  }
  return customDictionary[normalized] ?? bundled;
}

/**
 * 从自定义词典中删除一个词条。
 *
 * @param dictionary 当前词典。
 * @param word 要删除的单词。
 * @returns 删除后的词典副本。
 */
export function removeCustomDictionaryEntry(dictionary: CustomDictionary, word: string): CustomDictionary {
  const normalized = normalizeWord(word);
  if (!(normalized in dictionary)) {
    return dictionary;
  }

  const { [normalized]: _removed, ...rest } = dictionary;
  return rest;
}
