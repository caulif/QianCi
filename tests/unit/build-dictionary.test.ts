import { describe, expect, it } from 'vitest';
import { buildDictionaryPack } from '../../scripts/build-dictionary';

describe('dictionary pack builder', () => {
  it('filters invalid rows and emits compact dictionary, rank, and lemma indexes', () => {
    const pack = buildDictionaryPack(
      [
        { word: 'abrupt', phonetic: '/əˈbrʌpt/', translation: '突然的\n唐突的', frq: 6100, bnc: 8000, exchange: '' },
        { word: 'coherence', phonetic: '/koʊˈhɪrəns/', translation: '连贯性', frq: 7800, bnc: 9000, exchange: '' },
        { word: 'empty', phonetic: '', translation: '', frq: 1, bnc: 1, exchange: '' },
        { word: 'meticulous', phonetic: '/məˈtɪkjələs/', translation: '细致的', frq: 9200, bnc: 12000, exchange: '0:meticulous' }
      ],
      { limit: 2 }
    );

    expect(Object.keys(pack.dictionary)).toEqual(['abrupt', 'coherence']);
    expect(pack.dictionary.abrupt).toEqual({
      word: 'abrupt',
      phonetic: '/əˈbrʌpt/',
      translation: '突然的；唐突的',
      rank: 6100
    });
    expect(pack.rank.coherence).toBe(7800);
    expect(pack.lemma.abrupt).toEqual(['abrupt']);
  });
});
