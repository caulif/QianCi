import type { DictionaryEntry } from '../core/dictionaryEntry';
import { compactGloss } from '../core/dictionarySource';
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

interface LingvaResponse {
  translation?: string;
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
  /** 整次查词截止时间戳；超时后尽快失败或降级。 */
  deadlineAt?: number;
  totalBudgetMs?: number;
}

const ONLINE_RANK = 999999;
const FREE_DICTIONARY_ENDPOINT = 'https://freedictionaryapi.com/api/v1/entries/en';
const DICTIONARY_API_DEV_ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const LINGVA_ENDPOINT = 'https://lingva.ml/api/v1/en/zh';
/** 无密钥公共翻译接口（client=gtx），仅作词典与其它翻译源失败后的兜底。 */
const GOOGLE_GTX_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_SERVICE = { label: 'MyMemory', url: 'https://mymemory.translated.net/' };
const LINGVA_SERVICE = { label: 'Lingva Translate', url: 'https://lingva.ml/' };
const GOOGLE_GTX_SERVICE = { label: 'Google Translate', url: 'https://translate.google.com/' };
const DEFAULT_LOOKUP_TIMEOUT_MS = 5000;
/** 整次查词总预算，避免串行瀑布叠满多次超时。 */
const DEFAULT_TOTAL_BUDGET_MS = 10000;

type TranslationService = typeof MYMEMORY_SERVICE | typeof LINGVA_SERVICE | typeof GOOGLE_GTX_SERVICE;

interface TranslationResult {
  text: string;
  service: TranslationService;
}

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
    translation: compactGloss(translation) || translation.trim(),
    rank: ONLINE_RANK,
    source: 'online',
    attribution: {
      label: service.label === '机器翻译' ? '机器翻译' : 'Wiktionary',
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
): Promise<TranslationResult> {
  const text = definition.trim();
  if (!text) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  try {
    const translatedText = await translateDefinitionWithMyMemory(text, fetchImpl, timeoutMs);
    if (translatedText) {
      return { text: translatedText, service: MYMEMORY_SERVICE };
    }
  } catch {
    // MyMemory 是默认无账号翻译源；失败后继续尝试其它免费接口。
  }

  try {
    const translatedText = await translateDefinitionWithLingva(text, fetchImpl, timeoutMs);
    if (translatedText) {
      return { text: translatedText, service: LINGVA_SERVICE };
    }
  } catch {
    // Lingva 公共实例偶发不可用，继续 Google gtx 兜底。
  }

  const translatedText = await translateDefinitionWithGoogleGtx(text, fetchImpl, timeoutMs);
  if (!translatedText) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  return { text: translatedText, service: GOOGLE_GTX_SERVICE };
}

async function translateDefinitionWithMyMemory(
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

async function translateDefinitionWithLingva(
  definition: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string> {
  const url = `${LINGVA_ENDPOINT}/${encodeURIComponent(definition)}`;
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
  if (!response.ok) {
    throw createHttpFailure(response.status);
  }

  const payload = await readJsonResponse<LingvaResponse>(response);
  return payload.translation?.trim() ?? '';
}

/**
 * 解析 Google translate_a/single 的嵌套数组响应，拼出完整中文译文。
 *
 * @param payload Google gtx JSON 载荷。
 * @returns 合并后的译文；无法解析时返回空串。
 */
function extractGoogleGtxTranslation(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    return '';
  }

  const chunks: string[] = [];
  for (const segment of payload[0]) {
    if (Array.isArray(segment) && typeof segment[0] === 'string' && segment[0].trim()) {
      chunks.push(segment[0]);
    }
  }

  return chunks.join('').trim();
}

/**
 * 使用无密钥的 Google gtx 接口把英文译成中文（仅作兜底）。
 *
 * @param definition 待翻译英文。
 * @param fetchImpl fetch 实现。
 * @param timeoutMs 超时毫秒。
 * @returns 中文译文。
 */
async function translateDefinitionWithGoogleGtx(
  definition: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string> {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'zh-CN',
    dt: 't',
    q: definition
  });
  const url = `${GOOGLE_GTX_ENDPOINT}?${params.toString()}`;
  const response = await fetchWithTimeout(url, fetchImpl, timeoutMs);
  if (!response.ok) {
    throw createHttpFailure(response.status);
  }

  const payload = await readJsonResponse<unknown>(response);
  return extractGoogleGtxTranslation(payload);
}

/**
 * 词典源全部失败时，直接把单词机翻成中文作为最后底线。
 *
 * @param word 规范化英文单词。
 * @param fetchImpl fetch 实现。
 * @param timeoutMs 超时毫秒。
 * @returns 仅含机翻释义的词条。
 */
async function fetchMachineTranslatedWordEntry(
  word: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<DictionaryEntry> {
  const translationResult = await translateDefinitionToChinese(word, fetchImpl, timeoutMs);
  const normalizedTranslation = translationResult.text.trim().toLowerCase();
  if (!normalizedTranslation || normalizedTranslation === word) {
    throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
  }

  return buildEntry(
    word,
    '',
    translationResult.text,
    {
      label: '机器翻译',
      url: translationResult.service.url,
      sourceUrl: translationResult.service.url
    },
    translationResult.service
  );
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

  let translationResult: TranslationResult;
  try {
    translationResult = await translateDefinitionToChinese(definition, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
    }
    throw error;
  }

  entry = buildOnlineDictionaryEntry(normalized, payload, translationResult.text, translationResult.service);
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

  let translationResult: TranslationResult;
  try {
    translationResult = await translateDefinitionToChinese(definition, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof OnlineLookupFailure) {
      throw new OnlineLookupFailure('not_found', '在线词典暂无中文释义');
    }
    throw error;
  }

  const entry = buildDictionaryApiDevEntry(normalized, payload, translationResult.text, translationResult.service);
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

const PROVIDER_COOLDOWN_MS: Record<string, number> = {
  rate_limited: 60_000,
  service_unavailable: 30_000,
  timeout: 15_000,
  network_error: 10_000
};

const providerCooldownUntil = new Map<string, number>();
const inflightLookups = new Map<string, Promise<OnlineLookupResult>>();

/**
 * 测试用：清空 provider 冷却与 in-flight 请求状态。
 */
export function resetOnlineDictionaryRuntimeState(): void {
  providerCooldownUntil.clear();
  inflightLookups.clear();
}

function isProviderCoolingDown(providerId: string, now: number): boolean {
  return (providerCooldownUntil.get(providerId) ?? 0) > now;
}

function markProviderFailure(providerId: string, errorKind: OnlineLookupErrorKind, now: number): void {
  const cooldown = PROVIDER_COOLDOWN_MS[errorKind];
  if (!cooldown) {
    return;
  }
  const until = now + cooldown;
  const previous = providerCooldownUntil.get(providerId) ?? 0;
  if (until > previous) {
    providerCooldownUntil.set(providerId, until);
  }
}

function remainingTimeoutMs(deadlineAt: number, perStepMs: number): number {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new OnlineLookupFailure('timeout', '在线词典查询超时，请稍后再试');
  }
  // 尊重调用方传入的短 timeout（单测用 25ms）；长超时才保留最小步长避免 0ms 竞态。
  const floorMs = perStepMs >= 1000 ? 400 : 1;
  return Math.max(floorMs, Math.min(perStepMs, remaining));
}

async function fetchOnlineDictionaryEntryUnshared(
  word: string,
  fetchImpl: typeof fetch,
  options: FetchOnlineDictionaryOptions
): Promise<OnlineLookupResult> {
  const normalized = normalizeWord(word);
  const perStepMs = options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  const deadlineAt =
    options.deadlineAt ?? Date.now() + (options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS);
  const now = Date.now();

  try {
    let entry: DictionaryEntry;
    let primaryError: OnlineLookupFailure | undefined;
    try {
      if (isProviderCoolingDown('freedictionary', now)) {
        throw new OnlineLookupFailure('service_unavailable', '在线词典暂时不可用');
      }
      entry = await fetchFreeDictionaryEntry(
        normalized,
        fetchImpl,
        remainingTimeoutMs(deadlineAt, perStepMs)
      );
    } catch (error) {
      if (error instanceof OnlineLookupFailure) {
        markProviderFailure('freedictionary', error.errorKind, Date.now());
      }
      if (error instanceof OnlineLookupFailure && shouldTryDictionaryApiDevFallback(error)) {
        primaryError = error;
        try {
          if (isProviderCoolingDown('dictionaryapi', Date.now())) {
            throw new OnlineLookupFailure('service_unavailable', '在线词典暂时不可用');
          }
          entry = await fetchDictionaryApiDevEntry(
            normalized,
            fetchImpl,
            remainingTimeoutMs(deadlineAt, perStepMs)
          );
        } catch (fallbackError) {
          if (fallbackError instanceof OnlineLookupFailure) {
            markProviderFailure('dictionaryapi', fallbackError.errorKind, Date.now());
          }
          // 词典都失败时，再用免费机翻直接译单词，避免“查不到就彻底没结果”。
          try {
            if (isProviderCoolingDown('machine-translate', Date.now())) {
              throw new OnlineLookupFailure('service_unavailable', '在线词典暂时不可用');
            }
            entry = await fetchMachineTranslatedWordEntry(
              normalized,
              fetchImpl,
              remainingTimeoutMs(deadlineAt, perStepMs)
            );
          } catch (machineError) {
            if (machineError instanceof OnlineLookupFailure) {
              markProviderFailure('machine-translate', machineError.errorKind, Date.now());
            }
            const failures = [primaryError, fallbackError, machineError].filter(
              (item): item is OnlineLookupFailure => item instanceof OnlineLookupFailure
            );
            // 优先返回对用户更可操作的错误类型（未找到 > 限流/超时/网络）。
            const preferredOrder: OnlineLookupErrorKind[] = [
              'not_found',
              'rate_limited',
              'timeout',
              'network_error',
              'service_unavailable',
              'parse_error'
            ];
            for (const kind of preferredOrder) {
              const match = failures.find((item) => item.errorKind === kind);
              if (match) {
                throw match;
              }
            }
            throw primaryError ?? fallbackError;
          }
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

/**
 * 联网查词入口：同一单词请求单飞合并，并对失败 provider 做短冷却。
 */
export async function fetchOnlineDictionaryEntry(
  word: string,
  fetchImpl: typeof fetch = fetch,
  options: FetchOnlineDictionaryOptions = {}
): Promise<OnlineLookupResult> {
  const normalized = normalizeWord(word);
  const existing = inflightLookups.get(normalized);
  if (existing) {
    return existing;
  }

  const pending = fetchOnlineDictionaryEntryUnshared(normalized, fetchImpl, options).finally(() => {
    inflightLookups.delete(normalized);
  });
  inflightLookups.set(normalized, pending);
  return pending;
}
