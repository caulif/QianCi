import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOnlineDictionaryEntry,
  fetchOnlineDictionaryEntry,
  resetOnlineDictionaryRuntimeState
} from '../../src/background/onlineDictionary';

function createJsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

describe('online dictionary parser', () => {
  afterEach(() => {
    vi.useRealTimers();
    resetOnlineDictionaryRuntimeState();
  });

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

  it('keeps primary dictionary success separate from translation fallback failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          word: 'serendipity',
          entries: [
            {
              senses: [{ definition: 'The phenomenon of making an unplanned fortunate discovery.' }]
            }
          ]
        })
      )
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'translation unavailable' }))
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'fallback translation unavailable' }))
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'google translation unavailable' }));

    const result = await fetchOnlineDictionaryEntry('serendipity', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'not_found',
      message: '在线词典暂无中文释义'
    });
  });

  it('falls back to Google gtx when MyMemory and Lingva cannot translate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          word: 'serendipity',
          entries: [
            {
              pronunciations: [{ type: 'ipa', text: '/ˌserənˈdɪpəti/' }],
              senses: [{ definition: 'The phenomenon of making an unplanned fortunate discovery.' }]
            }
          ]
        })
      )
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'mymemory down' }))
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'lingva down' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, [[['意外幸运发现的现象', 'The phenomenon of making an unplanned fortunate discovery.']]])
      );

    const result = await fetchOnlineDictionaryEntry('serendipity', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'serendipity',
        translation: '意外幸运发现的现象',
        attribution: expect.objectContaining({
          translationServiceLabel: 'Google Translate',
          translationServiceUrl: 'https://translate.google.com/'
        })
      })
    );
    expect(String(fetchMock.mock.calls[3][0])).toContain('translate.googleapis.com');
  });

  it('machine-translates the word when both dictionary providers fail', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(404, { message: 'missing primary' }))
      .mockResolvedValueOnce(createJsonResponse(404, { message: 'missing secondary' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          responseData: {
            translatedText: '韧性'
          }
        })
      );

    const result = await fetchOnlineDictionaryEntry('resilience', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'resilience',
        translation: '韧性',
        attribution: expect.objectContaining({
          serviceLabel: '机器翻译',
          translationServiceLabel: 'MyMemory'
        })
      })
    );
  });

  it('falls back to Lingva when MyMemory cannot translate a definition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          word: 'serendipity',
          entries: [
            {
              pronunciations: [{ type: 'ipa', text: '/ˌserənˈdɪpəti/' }],
              senses: [{ definition: 'The phenomenon of making an unplanned fortunate discovery.' }]
            }
          ]
        })
      )
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'translation unavailable' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          translation: '意外幸运发现的现象'
        })
      );

    const result = await fetchOnlineDictionaryEntry('serendipity', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'serendipity',
        translation: '意外幸运发现的现象',
        attribution: expect.objectContaining({
          translationServiceLabel: 'Lingva Translate',
          translationServiceUrl: 'https://lingva.ml/'
        })
      })
    );
    expect(fetchMock.mock.calls[1][0]).toContain('api.mymemory.translated.net');
    expect(fetchMock.mock.calls[2][0]).toContain('lingva.ml');
  });

  it('tries dictionaryapi.dev when the primary dictionary provider is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(503, { message: 'primary unavailable' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, [
          {
            word: 'resilient',
            phonetic: '/rɪˈzɪliənt/',
            phonetics: [{ text: '/rɪˈzɪliənt/' }],
            meanings: [
              {
                partOfSpeech: 'adjective',
                definitions: [{ definition: 'Able to recover quickly from difficulties.' }]
              }
            ],
            sourceUrls: ['https://en.wiktionary.org/wiki/resilient']
          }
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          responseData: {
            translatedText: '能从困难中快速恢复的'
          }
        })
      );

    const result = await fetchOnlineDictionaryEntry('resilient', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'resilient',
        phonetic: '/rɪˈzɪliənt/',
        translation: '能从困难中快速恢复的',
        attribution: expect.objectContaining({
          serviceLabel: 'dictionaryapi.dev',
          serviceUrl: 'https://dictionaryapi.dev/',
          translationServiceLabel: 'MyMemory',
          translationServiceUrl: 'https://mymemory.translated.net/'
        })
      })
    );
    expect(fetchMock.mock.calls[0][0]).toContain('freedictionaryapi.com');
    expect(fetchMock.mock.calls[1][0]).toContain('api.dictionaryapi.dev');
    expect(fetchMock.mock.calls[2][0]).toContain('api.mymemory.translated.net');
  });

  it('tries dictionaryapi.dev when the primary dictionary provider has no entry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(404, { message: 'primary missing' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, [
          {
            word: 'laconic',
            phonetics: [{ text: '/ləˈkɒnɪk/' }],
            meanings: [{ definitions: [{ definition: 'Using very few words.' }] }],
            sourceUrls: ['https://en.wiktionary.org/wiki/laconic']
          }
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          responseData: {
            translatedText: '言简意赅的'
          }
        })
      );

    const result = await fetchOnlineDictionaryEntry('laconic', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'laconic',
        phonetic: '/ləˈkɒnɪk/',
        translation: '言简意赅的',
        attribution: expect.objectContaining({
          serviceLabel: 'dictionaryapi.dev',
          translationServiceLabel: 'MyMemory'
        })
      })
    );
    expect(fetchMock.mock.calls[0][0]).toContain('freedictionaryapi.com');
    expect(fetchMock.mock.calls[1][0]).toContain('api.dictionaryapi.dev');
  });

  it('tries dictionaryapi.dev when the primary dictionary fetch fails', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        createJsonResponse(200, [
          {
            word: 'tenacious',
            phonetics: [{ text: '/təˈneɪʃəs/' }],
            meanings: [{ definitions: [{ definition: 'Persistent and determined.' }] }],
            sourceUrls: ['https://en.wiktionary.org/wiki/tenacious']
          }
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          responseData: {
            translatedText: '坚持不懈的'
          }
        })
      );

    const result = await fetchOnlineDictionaryEntry('tenacious', fetchMock as never);

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual(
      expect.objectContaining({
        word: 'tenacious',
        phonetic: '/təˈneɪʃəs/',
        translation: '坚持不懈的',
        attribution: expect.objectContaining({
          serviceLabel: 'dictionaryapi.dev',
          translationServiceLabel: 'MyMemory'
        })
      })
    );
    expect(fetchMock.mock.calls[0][0]).toContain('freedictionaryapi.com');
    expect(fetchMock.mock.calls[1][0]).toContain('api.dictionaryapi.dev');
  });

  it('classifies missing words as not found', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(404, { message: 'Not found' }));

    const result = await fetchOnlineDictionaryEntry('missing', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'not_found'
    });
  });

  it('classifies rate limits explicitly', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(429, { message: 'Too many requests' }));

    const result = await fetchOnlineDictionaryEntry('limited', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'rate_limited'
    });
  });

  it('classifies server failures as service unavailable', async () => {
    const fetchMock = vi.fn(async () => createJsonResponse(503, { message: 'Unavailable' }));

    const result = await fetchOnlineDictionaryEntry('server', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'service_unavailable'
    });
  });

  it('classifies fetch rejections as network errors', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await fetchOnlineDictionaryEntry('offline', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'network_error'
    });
  });

  it('classifies slow providers as timeout errors', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              createJsonResponse(200, {
                word: 'slow',
                entries: [{ senses: [{ translations: [{ language: { code: 'zh' }, word: '慢的' }] }] }]
              })
            );
          }, 50);
        })
    );

    // per-step timeout short + total budget short so waterfall cannot outrun the test clock.
    const resultPromise = fetchOnlineDictionaryEntry('slow', fetchMock as never, {
      timeoutMs: 25,
      totalBudgetMs: 40
    });

    // 主词典、备用词典与机翻兜底都会各自触发超时，需要推进足够的假时间。
    await vi.advanceTimersByTimeAsync(500);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      errorKind: 'timeout'
    });
  });

  it('classifies malformed provider JSON as parse errors', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      }
    }));

    const result = await fetchOnlineDictionaryEntry('broken', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'parse_error'
    });
  });

  it('classifies entries without usable translations as not found', async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(200, {
        word: 'opaque',
        entries: [{ senses: [] }]
      })
    );

    const result = await fetchOnlineDictionaryEntry('opaque', fetchMock as never);

    expect(result).toMatchObject({
      ok: false,
      errorKind: 'not_found',
      message: '在线词典暂无中文释义'
    });
  });

  it('deduplicates concurrent lookups for the same word', async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = fetchOnlineDictionaryEntry('shared', fetchMock as never);
    const second = fetchOnlineDictionaryEntry('shared', fetchMock as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(
      createJsonResponse(200, {
        word: 'shared',
        entries: [
          {
            senses: [{ translations: [{ language: { code: 'zh' }, word: '共享的' }] }]
          }
        ]
      })
    );

    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.entry?.translation).toBe('共享的');
    expect(b.entry?.translation).toBe('共享的');
  });
});

