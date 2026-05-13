import { describe, expect, it, vi } from 'vitest';
import { buildOnlineDictionaryEntry, fetchOnlineDictionaryEntry } from '../../src/background/onlineDictionary';

describe('online dictionary parser', () => {
  it('builds a normalized entry from direct Chinese translations', () => {
    const entry = buildOnlineDictionaryEntry('Unobtrusive', {
      word: 'unobtrusive',
      entries: [
        {
          pronunciations: [{ type: 'ipa', text: '/ˌʌnəbˈtruːsɪv/' }],
          senses: [
            {
              translations: [
                { language: { code: 'zh', name: 'Chinese' }, word: '不唐突的' },
                { language: { code: 'zh-Hans', name: 'Chinese' }, word: '不显眼的' }
              ]
            }
          ]
        }
      ]
    });

    expect(entry).toEqual(
      expect.objectContaining({
        word: 'unobtrusive',
        phonetic: '/ˌʌnəbˈtruːsɪv/',
        translation: '不唐突的；不显眼的',
        source: 'online'
      })
    );
  });

  it('falls back to translated definitions when direct Chinese translations are missing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          word: 'serendipity',
          entries: [
            {
              pronunciations: [{ type: 'ipa', text: '/ˌserənˈdɪpəti/' }],
              senses: [{ definition: 'The phenomenon of making an unplanned fortunate discovery.' }]
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          responseData: {
            translatedText: '意外幸运发现的现象'
          }
        })
      });

    const result = await fetchOnlineDictionaryEntry('serendipity', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'serendipity',
        translation: '意外幸运发现的现象'
      })
    );
  });
});
