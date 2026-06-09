import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { OnlineLookupErrorKind, OnlineLookupResult } from '../core/messages';

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

interface DictionaryApiDevPhonetic {
  text?: string;
}

interface DictionaryApiDevDefinition {
  definition?: string;
}

interface DictionaryApiDevMeaning {
  definitions?: DictionaryApiDevDefinition[];
}

interface DictionaryApiDevEntry {
  word?: string;
  phonetic?: string;
  phonetics?: DictionaryApiDevPhonetic[];
  meanings?: DictionaryApiDevMeaning[];
  sourceUrls?: string[];
}

interface FetchOnlineDictionaryOptions {
  timeoutMs?: number;
}

const ONLINE_RANK = 999999;
const FREE_DICTIONARY_ENDPOINT = 'https://freedictionaryapi.com/api/v1/entries/en';
const DICTIONARY_API_DEV_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const MYMEMORY_SERVICE = { label: 'MyMemory', url: 'https://mymemory.translated.net/' };
const DEFAULT_LOOKUP_TIMEOUT_MS = 8000;

class OnlineLookupFailure extends Error {
  readonly errorKind: OnlineLookupErrorKind;

  /**
   * 创建可转换为 OnlineLookupResult 的联网查询失败。
   *
   * @param errorKind 失败分类，用于调用方展示精确状态。
   * @param message 面向用户的失败说明。
   */
  constructor(errorKind: OnlineLookupErrorKind, message: string) {
    super(message);
    this.name = 'OnlineLookupFailure';
    this.errorKind = errorKind;
  }
}

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

function buildEntry(
  word: string,
  phonetic: string,
  translation: string,
  service: { label: string; url: string; sourceUrl?: string } = {
    label: 'FreeDictionaryAPI',
    url: 'https://freedictionaryapi.com/'
  },
  translationService?: { label: string; url: string }
): DictionaryEntry {
  const normalized = normalizeWord(word);
  return {
    word: normalized,
    phonetic,
    translation,
    rank: ONLINE_RANK,
    source: 'online',
    attribution: {
      label: 'Wiktionary',
      url: service.sourceUrl ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(normalized)}`,
      serviceLabel: service.label,
      serviceUrl: service.url,
      translationServiceLabel: translationService?.label,
      translationServiceUrl: translationService?.url
    }
  };
}

function createFailureResult(errorKind: OnlineLookupErrorKind, message: string): OnlineLookupResult {
  return { ok: false, message, errorKind };
}

function createHttpFailure(status: number): OnlineLookupFailure {
  if (status === 404) {
    return new OnlineLookupFailure('not_found', '在线词典未找到这个词');
  }

  if (status === 429) {
    return new OnlineLookupFailure('rate_limited', '在线词典请求过于频繁，请稍后再试');
  }

  return new OnlineLookupFailure('service_unavailable', '在线词典暂时不可用');
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError'
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new OnlineLookupFailure('parse_error', '在线词典返回内容无法解析');
  }
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<Response> {
  const abortController = typeof AbortController === 'undefined' ? undefined : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController?.abort();
      reject(new OnlineLookupFailure('timeout', '在线词典查询超时，请稍后再试'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, abortController ? { signal: abortController.signal } : undefined),
      timeoutPromise
    ]);
    return response;
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      throw error;
    }

    if (isAbortError(error)) {
      throw new OnlineLookupFailure('timeout', '在线词典查询超时，请稍后再试');
    }

    throw new OnlineLookupFailure('network_error', '联网查询失败');
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function buildOnlineDictionaryEntry(
  word: string,
  payload: FreeDictionaryResponse,
  fallbackTranslation?: string,
  translationService?: { label: string; url: string }
): DictionaryEntry | undefined {
  const chineseTranslations = extractChineseTranslations(payload);
  const translation = chineseTranslations.length ? chineseTranslations.join('；') : fallbackTranslation?.trim();
  if (!translation) {
    return undefined;
  }

  return buildEntry(word, extractPhonetic(payload), translation, undefined, translationService);
}

function extractDictionaryApiDevPhonetic(payload: DictionaryApiDevEntry[]): string {
  return (
    payload.find((entry) => entry.phonetic)?.phonetic ??
    payload.flatMap((entry) => entry.phonetics ?? []).find((phonetic) => phonetic.text)?.text ??
    ''
  );
}

function extractDictionaryApiDevDefinition(payload: DictionaryApiDevEntry[]): string {
  const definitions = payload.flatMap((entry) =>
    (entry.meanings ?? []).flatMap((meaning) => (meaning.definitions ?? []).map((item) => item.definition ?? ''))
  );
  return definitions.find(Boolean)?.trim() ?? '';
}

function buildDictionaryApiDevEntry(
  word: string,
  payload: DictionaryApiDevEntry[],
  translation: string,
  translationService?: { label: string; url: string }
): DictionaryEntry | undefined {
  const safeTranslation = translation.trim();
  if (!safeTranslation) {
    return undefined;
  }

  const sourceUrl =
    payload.flatMap((entry) => entry.sourceUrls ?? []).find((url) => typeof url === 'string' && url.startsWith('http')) ??
    undefined;

  return buildEntry(word, extractDictionaryApiDevPhonetic(payload), safeTranslation, {
    label: 'dictionaryapi.dev',
    url: 'https://dictionaryapi.dev/',
    sourceUrl
  }, translationService);
}

async function translateDefinitionToChinese(
  definition: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string> {
  const url = `${MYMEMORY_ENDPOINT}?q=${encodeURIComponent(definition)}&langpair=en|zh-CN`;
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
  if (!response.ok) {
    throw createHttpFailure(response.status);
  }

  const payload = await readJsonResponse<MyMemoryResponse>(response);
  return payload.responseData?.translatedText?.trim() ?? '';
}

async function fetchFreeDictionaryEntry(
  normalized: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<DictionaryEntry> {
  const response = await fetchWithTimeout(
    `${FREE_DICTIONARY_ENDPOINT}/${encodeURIComponent(normalized)}?translations=true`,
    fetchImpl,
    timeoutMs
  );
  if (!response.ok) {
    throw createHttpFailure(response.status);
  }

  const payload = await readJsonResponse<FreeDictionaryResponse>(response);
  let entry = buildOnlineDictionaryEntry(normalized, payload);
  if (entry) {
    return entry;
  }

  const definition = extractDefinition(payload);
  if (!definition) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  let translated = '';
  try {
    translated = await translateDefinitionToChinese(definition, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
    }
    throw error;
  }

  entry = buildOnlineDictionaryEntry(normalized, payload, translated, MYMEMORY_SERVICE);
  if (!entry) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  return entry;
}

async function fetchDictionaryApiDevEntry(
  normalized: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number
): Promise<DictionaryEntry> {
  const response = await fetchWithTimeout(
    `${DICTIONARY_API_DEV_ENDPOINT}/${encodeURIComponent(normalized)}`,
    fetchImpl,
    timeoutMs
  );
  if (!response.ok) {
    throw createHttpFailure(response.status);
  }

  const payload = await readJsonResponse<DictionaryApiDevEntry[]>(response);
  if (!Array.isArray(payload)) {
    throw new OnlineLookupFailure('parse_error', '在线词典返回内容无法解析');
  }

  const definition = extractDictionaryApiDevDefinition(payload);
  if (!definition) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  let translated = '';
  try {
    translated = await translateDefinitionToChinese(definition, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
    }
    throw error;
  }

  const entry = buildDictionaryApiDevEntry(normalized, payload, translated, MYMEMORY_SERVICE);
  if (!entry) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  return entry;
}

function shouldTryDictionaryApiDevFallback(error: OnlineLookupFailure): boolean {
  return (
    error.errorKind === 'not_found' ||
    error.errorKind === 'rate_limited' ||
    error.errorKind === 'service_unavailable' ||
    error.errorKind === 'network_error' ||
    error.errorKind === 'timeout' ||
    error.errorKind === 'parse_error'
  );
}

export async function fetchOnlineDictionaryEntry(
  word: string,
  fetchImpl: typeof fetch = fetch,
  options: FetchOnlineDictionaryOptions = {}
): Promise<OnlineLookupResult> {
  const normalized = normalizeWord(word);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;

  try {
    let entry: DictionaryEntry;
    try {
      entry = await fetchFreeDictionaryEntry(normalized, fetchImpl, timeoutMs);
    } catch (error) {
      if (error instanceof OnlineLookupFailure && shouldTryDictionaryApiDevFallback(error)) {
        try {
          entry = await fetchDictionaryApiDevEntry(normalized, fetchImpl, timeoutMs);
        } catch {
          throw error;
        }
      } else {
        throw error;
      }
    }

    return {
      ok: true,
      message: '已同步到词库',
      entry
    };
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      return createFailureResult(error.errorKind, error.message);
    }

    return createFailureResult('network_error', '联网查询失败');
  }
}
