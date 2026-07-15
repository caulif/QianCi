import { describe, expect, it } from 'vitest';
import {
  buildFullBackup,
  mergeVocabLists,
  parseBackupJson
} from '../../src/core/backup';
import { createProfile } from '../../src/core/profile';

describe('backup import export', () => {
  it('builds and parses a full backup round trip', () => {
    const profile = createProfile('cet4');
    const backup = buildFullBackup({
      profile,
      vocab: [{ word: 'resilient', translation: '有韧性的', lastSeenAt: 1, lookupCount: 2 }],
      customDictionary: {
        resilient: {
          word: 'resilient',
          phonetic: '',
          translation: '有韧性的',
          rank: 1,
          source: 'custom'
        }
      },
      sitePolicies: {
        'example.com': { mode: 'safe', updatedAt: 10, excludeSelectors: ['.ads'] }
      }
    });

    const parsed = parseBackupJson(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    expect(parsed.backup?.vocab?.[0]?.word).toBe('resilient');
    expect(parsed.backup?.sitePolicies?.['example.com']?.mode).toBe('safe');
    expect(parsed.backup?.customDictionary?.resilient?.source).toBe('custom');
  });

  it('accepts legacy vocab json export format', () => {
    const parsed = parseBackupJson(
      JSON.stringify({
        format: 'qianci-vocab-json-v1',
        exportedAt: '2026-01-01T00:00:00.000Z',
        items: [{ word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 1 }]
      })
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.backup?.vocab).toEqual([
      { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 1 }
    ]);
  });

  it('rejects invalid backup payload', () => {
    expect(parseBackupJson('{').ok).toBe(false);
    expect(parseBackupJson('{"formatVersion":2}').ok).toBe(false);
    expect(parseBackupJson('{}').ok).toBe(false);
  });

  it('merges vocab lists by conflict strategy', () => {
    const current = [{ word: 'a', translation: '旧', lastSeenAt: 1, lookupCount: 1 }];
    const incoming = [
      { word: 'a', translation: '新', lastSeenAt: 9, lookupCount: 5 },
      { word: 'b', translation: '乙', lastSeenAt: 2, lookupCount: 1 }
    ];

    expect(mergeVocabLists(current, incoming, 'skip').map((item) => item.translation).sort()).toEqual(['乙', '旧']);
    expect(mergeVocabLists(current, incoming, 'overwrite')).toEqual(incoming);
    expect(mergeVocabLists(current, incoming, 'merge').find((item) => item.word === 'a')).toEqual({
      word: 'a',
      translation: '新',
      lastSeenAt: 9,
      lookupCount: 5
    });
  });
});
