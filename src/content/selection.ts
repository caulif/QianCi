const SINGLE_WORD_PATTERN = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;

export function normalizeSelectedWord(selection: string): string | null {
  const trimmed = selection.trim();
  if (!SINGLE_WORD_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}
