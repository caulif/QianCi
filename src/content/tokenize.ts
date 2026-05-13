export interface EnglishToken {
  text: string;
  normalized: string;
  start: number;
  end: number;
}

interface Range {
  start: number;
  end: number;
}

const IGNORE_PATTERN = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g;
const WORD_PATTERN = /\b[A-Za-z]+(?:'[A-Za-z]+)?\b/g;

function isInsideIgnoredRange(index: number, ranges: Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

export function extractEnglishTokens(text: string): EnglishToken[] {
  const ignored: Range[] = [];
  for (const match of text.matchAll(IGNORE_PATTERN)) {
    ignored.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    });
  }

  const tokens: EnglishToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    if (isInsideIgnoredRange(start, ignored)) {
      continue;
    }

    const token = match[0];
    tokens.push({
      text: token,
      normalized: token.toLowerCase(),
      start,
      end: start + token.length
    });
  }

  return tokens;
}
