import { describe, expect, it } from 'vitest';
import { normalizeSelectedWord } from '../../src/content/selection';

describe('selection capture', () => {
  it('accepts a single English word', () => {
    expect(normalizeSelectedWord(' Serendipity ')).toBe('serendipity');
  });

  it('rejects phrases and non-English selections for the MVP', () => {
    expect(normalizeSelectedWord('two words')).toBeNull();
    expect(normalizeSelectedWord('中文')).toBeNull();
  });
});
