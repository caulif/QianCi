import type { OnlineLookupErrorKind } from '../core/messages';
import type { KeyValueStore } from './browserAdapter';

export interface OnlineLookupQueueItem {
  word: string;
  attempts: number;
  lastErrorKind: OnlineLookupErrorKind;
  lastTriedAt: number;
  nextRetryAt: number;
}

export type OnlineLookupQueue = Record<string, OnlineLookupQueueItem>;

export const ONLINE_LOOKUP_QUEUE_KEY = 'qianci.onlineLookupQueue';
const RETRYABLE_ERROR_KINDS: OnlineLookupErrorKind[] = [
  'network_error',
  'timeout',
  'service_unavailable',
  'rate_limited'
];
const BASE_RETRY_DELAY_MS = 2 * 60 * 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 10 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function shouldRetryOnlineLookupError(
  errorKind: OnlineLookupErrorKind | undefined
): errorKind is OnlineLookupErrorKind {
  return Boolean(errorKind && RETRYABLE_ERROR_KINDS.includes(errorKind));
}

function retryDelayMs(errorKind: OnlineLookupErrorKind, attempts: number): number {
  if (errorKind === 'rate_limited') {
    return RATE_LIMIT_RETRY_DELAY_MS;
  }

  return BASE_RETRY_DELAY_MS * Math.max(1, attempts);
}

function normalizeQueueItem(value: unknown): OnlineLookupQueueItem | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const item = value as Partial<OnlineLookupQueueItem>;
  const lastErrorKind = item.lastErrorKind;
  if (
    typeof item.word !== 'string' ||
    typeof item.attempts !== 'number' ||
    typeof item.lastTriedAt !== 'number' ||
    typeof item.nextRetryAt !== 'number' ||
    !shouldRetryOnlineLookupError(lastErrorKind)
  ) {
    return undefined;
  }

  return {
    word: normalizeWord(item.word),
    attempts: item.attempts,
    lastErrorKind,
    lastTriedAt: item.lastTriedAt,
    nextRetryAt: item.nextRetryAt
  };
}

export function normalizeOnlineLookupQueue(value: unknown): OnlineLookupQueue {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const queue: OnlineLookupQueue = {};
  for (const [word, itemValue] of Object.entries(value as Record<string, unknown>)) {
    const item = normalizeQueueItem(itemValue);
    if (item) {
      queue[normalizeWord(word)] = item;
    }
  }

  return queue;
}

export function enqueueOnlineLookupRetry(
  queue: OnlineLookupQueue,
  word: string,
  errorKind: OnlineLookupErrorKind,
  now: number
): OnlineLookupQueue {
  if (!shouldRetryOnlineLookupError(errorKind)) {
    return queue;
  }

  const normalized = normalizeWord(word);
  const previousAttempts = queue[normalized]?.attempts ?? 0;
  const attempts = previousAttempts + 1;
  if (attempts > MAX_RETRY_ATTEMPTS) {
    return removeOnlineLookupRetry(queue, normalized);
  }

  return {
    ...queue,
    [normalized]: {
      word: normalized,
      attempts,
      lastErrorKind: errorKind,
      lastTriedAt: now,
      nextRetryAt: now + retryDelayMs(errorKind, attempts)
    }
  };
}

export function removeOnlineLookupRetry(queue: OnlineLookupQueue, word: string): OnlineLookupQueue {
  const normalized = normalizeWord(word);
  const { [normalized]: _removed, ...rest } = queue;
  return rest;
}

export function dueOnlineLookupItems(queue: OnlineLookupQueue, now: number): OnlineLookupQueueItem[] {
  return Object.values(queue)
    .filter((item) => item.nextRetryAt <= now)
    .sort((left, right) => left.nextRetryAt - right.nextRetryAt);
}

export function nextOnlineLookupRetryAt(queue: OnlineLookupQueue): number | undefined {
  const retryTimes = Object.values(queue).map((item) => item.nextRetryAt);
  return retryTimes.length ? Math.min(...retryTimes) : undefined;
}

export async function loadOnlineLookupQueue(store: KeyValueStore): Promise<OnlineLookupQueue> {
  const items = await store.get<{ [ONLINE_LOOKUP_QUEUE_KEY]?: unknown }>([ONLINE_LOOKUP_QUEUE_KEY]);
  return normalizeOnlineLookupQueue(items[ONLINE_LOOKUP_QUEUE_KEY]);
}

export async function saveOnlineLookupQueue(store: KeyValueStore, queue: OnlineLookupQueue): Promise<void> {
  await store.set({ [ONLINE_LOOKUP_QUEUE_KEY]: normalizeOnlineLookupQueue(queue) });
}
