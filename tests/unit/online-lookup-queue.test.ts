import { describe, expect, it } from 'vitest';
import {
  dueOnlineLookupItems,
  enqueueOnlineLookupRetry,
  removeOnlineLookupRetry,
  shouldRetryOnlineLookupError
} from '../../src/storage/onlineLookupQueueStore';

describe('online lookup retry queue', () => {
  it('queues retryable lookup failures with backoff metadata', () => {
    const queue = enqueueOnlineLookupRetry({}, ' Serendipity ', 'network_error', 1_000);

    expect(queue.serendipity).toEqual(
      expect.objectContaining({
        word: 'serendipity',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 1_000
      })
    );
    expect(queue.serendipity?.nextRetryAt).toBeGreaterThan(1_000);
  });

  it('increments attempts and stops retrying non-retryable errors', () => {
    const once = enqueueOnlineLookupRetry({}, 'serendipity', 'timeout', 1_000);
    const twice = enqueueOnlineLookupRetry(once, 'serendipity', 'service_unavailable', 2_000);

    expect(twice.serendipity?.attempts).toBe(2);
    expect(shouldRetryOnlineLookupError('not_found')).toBe(false);
    expect(shouldRetryOnlineLookupError('parse_error')).toBe(false);
  });

  it('returns due items and removes successful retries', () => {
    const queued = enqueueOnlineLookupRetry({}, 'serendipity', 'rate_limited', 1_000);
    const due = dueOnlineLookupItems(queued, Number.MAX_SAFE_INTEGER);
    const removed = removeOnlineLookupRetry(queued, 'serendipity');

    expect(due.map((item) => item.word)).toEqual(['serendipity']);
    expect(removed.serendipity).toBeUndefined();
  });
});
