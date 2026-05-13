import { describe, expect, it } from 'vitest';
import { buildVocabCsv, renderOptions } from '../../src/options/main';

describe('options page', () => {
  it('renders the level slider and vocab table', () => {
    const root = document.createElement('div');

    renderOptions(root, {
      level: 'cet4',
      vocab: [
        { word: 'abrupt', translation: '突然的', lastSeenAt: 1, lookupCount: 2 },
        { word: 'coherence', translation: '连贯性', lastSeenAt: 2, lookupCount: 1 }
      ]
    });

    expect(root.textContent).toContain('四级');
    expect(root.textContent).toContain('abrupt');
    expect(root.querySelector('input[type="range"]')).not.toBeNull();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
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
