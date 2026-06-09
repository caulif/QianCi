import { describe, expect, it, vi } from 'vitest';
import { createTieredDictionaryResolver } from '../../src/content/dictionary';
import type { RuntimeDictionaryPack } from '../../src/content/dictionary';

function pack(words: Record<string, string>): RuntimeDictionaryPack {
  return {
    dictionary: Object.fromEntries(
      Object.entries(words).map(([word, translation], index) => [
        word,
        {
          word,
          phonetic: '',
          translation,
          rank: index + 1
        }
      ])
    ),
    lemma: {}
  };
}

describe('tiered dictionary resolver', () => {
  it('loads only the selected offline dictionary packs when resolving entries', async () => {
    const coreLoader = vi.fn(async () => pack({ abrupt: '突然的' }));
    const extendedLoader = vi.fn(async () => pack({ meticulous: '细致的' }));
    const fullLoader = vi.fn(async () => pack({ serendipity: '意外发现' }));

    const coreResolver = createTieredDictionaryResolver(
      [
        { tier: 'core', loadPack: coreLoader },
        { tier: 'extended', loadPack: extendedLoader },
        { tier: 'full', loadPack: fullLoader }
      ],
      'core'
    );

    expect(await coreResolver.resolveEntry('abrupt')).toMatchObject({ translation: '突然的' });
    expect(await coreResolver.resolveEntry('meticulous')).toBeUndefined();
    expect(coreLoader).toHaveBeenCalledOnce();
    expect(extendedLoader).not.toHaveBeenCalled();
    expect(fullLoader).not.toHaveBeenCalled();

    const extendedResolver = createTieredDictionaryResolver(
      [
        { tier: 'core', loadPack: coreLoader },
        { tier: 'extended', loadPack: extendedLoader },
        { tier: 'full', loadPack: fullLoader }
      ],
      'extended'
    );

    expect(await extendedResolver.resolveEntry('meticulous')).toMatchObject({ translation: '细致的' });
    expect(extendedLoader).toHaveBeenCalledOnce();
    expect(fullLoader).not.toHaveBeenCalled();
  });
});
