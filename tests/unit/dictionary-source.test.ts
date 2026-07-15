import { describe, expect, it } from 'vitest';
import {
  compactGloss,
  dictionarySourceLabel,
  isMachineTranslationEntry
} from '../../src/core/dictionarySource';
import {
  resolveEntryWithPriority,
  upsertCustomDictionary,
  upsertOnlineDictionaryEntry
} from '../../src/storage/customDictionaryStore';

describe('dictionarySource labels and gloss', () => {
  it('labels bundled, custom, online dictionary, and machine translation', () => {
    expect(dictionarySourceLabel({ source: 'bundled' })).toBe('本地词库');
    expect(dictionarySourceLabel({ source: 'custom' })).toBe('我的释义');
    expect(
      dictionarySourceLabel({
        source: 'online',
        attribution: { label: 'Wiktionary', url: 'https://en.wiktionary.org/' }
      })
    ).toBe('在线词典');
    expect(
      dictionarySourceLabel({
        source: 'online',
        attribution: { label: '机器翻译', url: 'https://translate.google.com/' }
      })
    ).toBe('机器翻译（仅供参考）');
    expect(
      isMachineTranslationEntry({
        attribution: { label: '机器翻译', url: 'https://translate.google.com/' }
      })
    ).toBe(true);
  });

  it('compacts long multi-sense glosses for reading cards', () => {
    expect(compactGloss('不唐突的；不显眼的；低调的')).toBe('不唐突的；不显眼的');
    expect(compactGloss('短义')).toBe('短义');
    const long =
      '这是一段非常非常长的机器翻译释义用来测试截断是否按阅读卡片长度限制工作并且不要撑爆界面';
    expect(compactGloss(long).length).toBeLessThanOrEqual(40);
    expect(compactGloss(long).endsWith('…') || compactGloss(long).length <= 40).toBe(true);
  });
});

describe('custom vs online upsert priority', () => {
  it('prefers custom over online cache over bundled on resolve', () => {
    let dict = upsertCustomDictionary(
      {},
      { word: 'serendipity', phonetic: '', translation: '我的释义', rank: 1, source: 'custom' }
    );
    dict = upsertOnlineDictionaryEntry(dict, {
      word: 'serendipity',
      phonetic: '',
      translation: '联网义',
      rank: 999,
      source: 'online'
    });
    expect(dict.serendipity?.translation).toBe('我的释义');
    expect(dict.serendipity?.source).toBe('custom');

    const bundled = {
      word: 'serendipity',
      phonetic: '',
      translation: '离线义',
      rank: 100,
      source: 'bundled' as const
    };
    expect(resolveEntryWithPriority(dict, 'serendipity', bundled)?.translation).toBe('我的释义');

    const onlineOnly = upsertOnlineDictionaryEntry(
      {},
      { word: 'ephemeral', phonetic: '', translation: '短暂的', rank: 9, source: 'online' }
    );
    expect(resolveEntryWithPriority(onlineOnly, 'ephemeral', bundled)?.translation).toBe('短暂的');
    expect(resolveEntryWithPriority({}, 'missing', bundled)?.translation).toBe('离线义');
  });
});
