import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { OnlineLookupResult } from '../core/messages';

interface FreeDictionaryTranslation {
  language?: { code?: string; name?: string };
  word?: string;
}

interface FreeDictionarySense {
  definition?: string;
  translations?: FreeDictionaryTranslation[];
}

interface FreeDictionaryPronunciation {
  type?: string;
  text?: string;
}

interface FreeDictionaryEntry {
  pronunciations?: FreeDictionaryPronunciation[];
  senses?: FreeDictionarySense[];
}

interface FreeDictionaryResponse {
  word?: string;
  entries?: FreeDictionaryEntry[];
}

interface MyMemoryResponse {
  responseData?: {
    translatedText?: string;
  };
}

const ONLINE_RANK = 999999;
const FREE_DICTIONARY_ENDPOINT = 'https://freedictionaryapi.com/api/v1/entries/en';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

function uniqueTexts(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function extractPhonetic(payload: FreeDictionaryResponse): string {
  const pronunciations = payload.entries?.flatMap((entry) => entry.pronunciations ?? []) ?? [];
  const ipa = pronunciations.find((item) => item.type === 'ipa' && item.text)?.text;
  return ipa ?? pronunciations.find((item) => item.text)?.text ?? '';
}

function extractChineseTranslations(payload: FreeDictionaryResponse): string[] {
  const translations =
    payload.entries?.flatMap((entry) =>
      (entry.senses ?? []).flatMap((sense) =>
        (sense.translations ?? [])
          .filter((translation) => translation.language?.code?.startsWith('zh'))
          .map((translation) => translation.word ?? '')
      )
    ) ?? [];

  return uniqueTexts(translations).slice(0, 3);
}

function extractDefinition(payload: FreeDictionaryResponse): string {
  const definitions =
    payload.entries?.flatMap((entry) => (entry.senses ?? []).map((sense) => sense.definition ?? '')) ?? [];
  return definitions.find(Boolean)?.trim() ?? '';
}

function buildEntry(word: string, phonetic: string, translation: string): DictionaryEntry {
  return {
    word: normalizeWord(word),
    phonetic,
    translation,
    rank: ONLINE_RANK,
    source: 'online',
    attribution: {
      label: 'Wiktionary',
      url: `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizeWord(word))}`,
      serviceLabel: 'FreeDictionaryAPI',
      serviceUrl: 'https://freedictionaryapi.com/'
    }
  };
}

export function buildOnlineDictionaryEntry(
  word: string,
  payload: FreeDictionaryResponse,
  fallbackTranslation?: string
): DictionaryEntry | undefined {
  const chineseTranslations = extractChineseTranslations(payload);
  const translation = chineseTranslations.length ? chineseTranslations.join('；') : fallbackTranslation?.trim();
  if (!translation) {
    return undefined;
  }

  return buildEntry(word, extractPhonetic(payload), translation);
}

async function translateDefinitionToChinese(definition: string, fetchImpl: typeof fetch): Promise<string> {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(definition)}&langpair=en|zh-CN`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    return '';
  }

  const payload = (await response.json()) as MyMemoryResponse;
  return payload.responseData?.translatedText?.trim() ?? '';
}

export async function fetchOnlineDictionaryEntry(
  word: string,
  fetchImpl: typeof fetch = fetch
): Promise<OnlineLookupResult> {
  const normalized = normalizeWord(word);

  try {
    const response = await fetchImpl(`${FREE_DICTIONARY_ENDPOINT}/${encodeURIComponent(normalized)}?translations=true`);
    if (response.status === 404) {
      return { ok: false, message: '在线词典未找到这个词' };
    }
    if (!response.ok) {
      return { ok: false, message: '在线词典暂时不可用' };
    }

    const payload = (await response.json()) as FreeDictionaryResponse;
    let entry = buildOnlineDictionaryEntry(normalized, payload);
    if (!entry) {
      const definition = extractDefinition(payload);
      if (!definition) {
        return { ok: false, message: '在线词典暂无中文释义' };
      }

      const translated = await translateDefinitionToChinese(definition, fetchImpl);
      entry = buildOnlineDictionaryEntry(normalized, payload, translated);
      if (!entry) {
        return { ok: false, message: '在线词典暂无中文释义' };
      }
    }

    return {
      ok: true,
      message: '已同步到词库',
      entry
    };
  } catch {
    return { ok: false, message: '联网查询失败' };
  }
}
