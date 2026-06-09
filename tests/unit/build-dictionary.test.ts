import { describe, expect, it } from 'vitest';
import { buildDictionaryPack, buildDictionaryPacks, parseDictionaryRowsFromCsv } from '../../scripts/build-dictionary';

describe('dictionary pack builder', () => {
  it('parses quoted ECDICT csv rows with embedded newlines', () => {
    const rows = parseDictionaryRowsFromCsv(`word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
abrupt,/əˈbrʌpt/,,"突然的
唐突的",,1,,,8000,6100,,,
meticulous,/məˈtɪkjələs/,,"细致的",,1,,,12000,9200,p:meticulous/d:meticulous,,`);

    expect(rows).toEqual([
      {
        word: 'abrupt',
        phonetic: '/əˈbrʌpt/',
        translation: '突然的\n唐突的',
        frq: 6100,
        bnc: 8000,
        exchange: '',
        lemma: ''
      },
      {
        word: 'meticulous',
        phonetic: '/məˈtɪkjələs/',
        translation: '细致的',
        frq: 9200,
        bnc: 12000,
        exchange: 'p:meticulous/d:meticulous',
        lemma: 'p:meticulous/d:meticulous'
      }
    ]);
  });

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

  it('splits dictionary entries into ordered offline packs without duplicating earlier words', () => {
    const rows = [
      { word: 'alpha', phonetic: '/a/', translation: '甲', frq: 100, bnc: 100, exchange: '' },
      { word: 'bravo', phonetic: '/b/', translation: '乙', frq: 200, bnc: 200, exchange: '' },
      { word: 'charlie', phonetic: '/c/', translation: '丙', frq: 300, bnc: 300, exchange: '' },
      { word: 'delta', phonetic: '/d/', translation: '丁', frq: 400, bnc: 400, exchange: '' },
      { word: 'echo', phonetic: '/e/', translation: '戊', frq: 500, bnc: 500, exchange: '' }
    ];

    const packs = buildDictionaryPacks(rows, [
      { id: 'core', limit: 2 },
      { id: 'extended', limit: 4 },
      { id: 'full', limit: 10 }
    ]);

    expect(Object.keys(packs.core.dictionary)).toEqual(['alpha', 'bravo']);
    expect(Object.keys(packs.extended.dictionary)).toEqual(['charlie', 'delta']);
    expect(Object.keys(packs.full.dictionary)).toEqual(['echo']);
    expect(packs.extended.lemma.charlie).toEqual(['charlie']);
    expect(packs.full.lemma.alpha).toBeUndefined();
  });
});
