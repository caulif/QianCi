import { describe, expect, it } from 'vitest';
import { buildVocabCsv, mountOptionsApp, renderOptions } from '../../src/options/main';
import { createMemoryStore } from '../../src/storage/browserAdapter';
import { createProfile } from '../../src/core/profile';

describe('options page', () => {
  it('renders the level slider and vocab table', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ],
      knownWords: [
        { word: 'serendipity', lastSeenAt: 3 }
      ]
    });

    expect(root.textContent).toContain('四级');
    expect(root.textContent).toContain('abrupt');
    expect(root.textContent).toContain('熟词');
    expect(root.textContent).toContain('serendipity');
    expect(root.querySelector('input[type="range"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-qianci-tone]')).toHaveLength(5);
    expect(root.querySelectorAll('[data-qianci-lookup-trigger]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-qianci-manual-shortcut]')).toHaveLength(4);
    expect(root.querySelectorAll('.vocab-table tbody')[0]?.querySelectorAll('tr')).toHaveLength(2);
  });

  it('filters vocab and known words by search text', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ],
      knownWords: [
        { word: 'serendipity', lastSeenAt: 3 },
        { word: 'apple', lastSeenAt: 4 }
      ],
      searchQuery: 'app'
    });

    const tables = root.querySelectorAll('.vocab-table tbody');
    expect(tables[0]?.textContent).not.toContain('abrupt');
    expect(tables[0]?.textContent).not.toContain('coherence');
    expect(tables[0]?.textContent).toContain('还没有生词');
    expect(tables[1]?.textContent).toContain('apple');
    expect(tables[1]?.textContent).not.toContain('serendipity');
  });

  it('lets the user remove vocab and move a known word back out of the known list', async () => {
    const root = document.createElement('div');
    const profile = createProfile('cet4');
    profile.words.apple = {
      familiarity: 0,
      isKnown: true,
      isUnknown: false,
      lastSeenAt: 3,
      seenPages: {}
    };

    const store = createMemoryStore({
      'qianci.profile': profile,
      'qianci.vocab': [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ]
    });

    await mountOptionsApp(root, store);

    const removeButtons = root.querySelectorAll('[data-qianci-remove-vocab]');
    expect(removeButtons).toHaveLength(2);
    (removeButtons[0] as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.textContent).not.toContain('abrupt');
    expect(root.textContent).toContain('coherence');

    const forgetButtons = root.querySelectorAll('[data-qianci-forget-known]');
    expect(forgetButtons).toHaveLength(1);
    (forgetButtons[0] as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.textContent).not.toContain('apple');
    expect(root.textContent).toContain('还没有熟词');
  });
});

describe('CSV export', () => {
  it('escapes commas and quotes in vocab rows', () => {
    const csv = buildVocabCsv([
      { word: 'abrupt', translation: '突然的, "唐突的"', lastSeenAt: 100, lookupCount: 2 }
    ]);

    expect(csv).toContain('word,translation,lastSeenAt,lookupCount');
    expect(csv).toContain('abrupt,"突然的, ""唐突的""",100,2');
  });
});
