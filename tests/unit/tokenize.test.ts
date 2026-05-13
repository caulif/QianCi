import { describe, expect, it } from 'vitest';
import { extractEnglishTokens } from '../../src/content/tokenize';

describe('content tokenization', () => {
  it('extracts English word tokens with offsets from prose', () => {
    const tokens = extractEnglishTokens('An unobtrusive tool feels meticulous.');

    expect(tokens.map((token) => token.text)).toEqual(['An', 'unobtrusive', 'tool', 'feels', 'meticulous']);
    expect(tokens[1]).toMatchObject({ text: 'unobtrusive', normalized: 'unobtrusive', start: 3, end: 14 });
  });

  it('ignores URLs, email addresses, and numeric fragments', () => {
    const tokens = extractEnglishTokens('See https://example.com, email hi@example.com, and version 2.0.');

    expect(tokens.map((token) => token.text)).toEqual(['See', 'email', 'and', 'version']);
  });
});
