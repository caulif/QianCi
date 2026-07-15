const SINGLE_WORD_PATTERN = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;
const HYPHENATED_WORD_PATTERN = /^[A-Za-z]+(?:-[A-Za-z]+)+$/;

/**
 * 去掉选区两端常见标点/引号，便于点选带句号的词。
 */
function stripSelectionPunctuation(selection: string): string {
  return selection
    .trim()
    .replace(/^["'`“”‘’(\[{<]+/u, '')
    .replace(/[.,;:!?)"'`”’\]}>]+$/u, '');
}

/**
 * 将用户选区规范为可查的单个英文词（小写）；短语返回 null。
 *
 * @param selection 原始选区文本。
 * @returns 规范化单词，或 null。
 */
export function normalizeSelectedWord(selection: string): string | null {
  const trimmed = stripSelectionPunctuation(selection);
  if (!trimmed) {
    return null;
  }

  if (HYPHENATED_WORD_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (!SINGLE_WORD_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * 简单屈折候选（先本地再联网），不做完整形态学。
 * 顺序：原形优先，再去 -ies/-es/-s/-ed/-ing 等。
 *
 * @param word 规范化英文词。
 * @returns 去重后的候选列表（含原词）。
 */
export function inflectionLookupCandidates(word: string): string[] {
  const normalized = word.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const candidates: string[] = [normalized];

  const push = (value: string): void => {
    if (value && value !== normalized && value.length >= 2 && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  if (normalized.endsWith('ies') && normalized.length > 4) {
    push(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith('ves') && normalized.length > 4) {
    push(`${normalized.slice(0, -3)}f`);
    push(`${normalized.slice(0, -3)}fe`);
  }
  if (normalized.endsWith('es') && normalized.length > 3) {
    push(normalized.slice(0, -2));
  }
  if (normalized.endsWith('s') && !normalized.endsWith('ss') && normalized.length > 2) {
    push(normalized.slice(0, -1));
  }
  if (normalized.endsWith('ied') && normalized.length > 4) {
    push(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith('ed') && normalized.length > 3) {
    push(normalized.slice(0, -2));
    push(normalized.slice(0, -1));
  }
  if (normalized.endsWith('ing') && normalized.length > 4) {
    push(normalized.slice(0, -3));
    // running -> run
    const withoutIng = normalized.slice(0, -3);
    if (withoutIng.length >= 2 && withoutIng.at(-1) === withoutIng.at(-2)) {
      push(withoutIng.slice(0, -1));
    }
  }

  return candidates;
}
