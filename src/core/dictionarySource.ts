import type { DictionaryEntry } from './dictionaryEntry';

/**
 * 用户可见的词条来源短标签（卡片 / popup / 设置共用）。
 *
 * @param entry 词条；缺省 source 按本地词库。
 * @returns 本地词库 / 我的释义 / 在线词典 / 机器翻译（仅供参考）。
 */
export function dictionarySourceLabel(entry: Pick<DictionaryEntry, 'source' | 'attribution'> | undefined): string {
  if (!entry?.source || entry.source === 'bundled') {
    return '本地词库';
  }
  if (entry.source === 'custom') {
    return '我的释义';
  }
  if (entry.source === 'online') {
    if (isMachineTranslationEntry(entry)) {
      return '机器翻译（仅供参考）';
    }
    return '在线词典';
  }
  return '本地词库';
}

/**
 * 是否为「仅对单词做机翻」的兜底结果（非词典义）。
 */
export function isMachineTranslationEntry(entry: Pick<DictionaryEntry, 'attribution'>): boolean {
  const label = entry.attribution?.label ?? '';
  const service = entry.attribution?.serviceLabel ?? '';
  return label === '机器翻译' || service === '机器翻译';
}

const MAX_GLOSS_CHARS = 40;
const MAX_GLOSS_SENSES = 2;

/**
 * 压缩释义为阅读用短义：按分号切分、去方括号注、截断条数与总长。
 *
 * @param text 原始中文释义。
 * @returns 卡片主行可用的短义。
 */
export function compactGloss(text: string): string {
  const parts = text
    .split(/[；;\n]+/)
    .map((part) => part.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean)
    .slice(0, MAX_GLOSS_SENSES);

  if (!parts.length) {
    return '';
  }

  let joined = parts.join('；');
  if (joined.length <= MAX_GLOSS_CHARS) {
    return joined;
  }

  // 优先保留第一义，再截断。
  const first = parts[0];
  if (first.length <= MAX_GLOSS_CHARS) {
    return first;
  }
  return `${first.slice(0, MAX_GLOSS_CHARS - 1)}…`;
}
