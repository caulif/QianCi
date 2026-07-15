import type { UserProfile, SitePolicies } from './types';
import type { CustomDictionary } from '../storage/customDictionaryStore';
import type { VocabItem } from '../storage/vocabStore';
import { normalizeProfile } from './profile';
import { normalizeSitePolicies } from '../storage/sitePolicyStore';

export const BACKUP_FORMAT_VERSION = 1 as const;

export interface QianCiBackup {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  profile?: UserProfile;
  vocab?: VocabItem[];
  customDictionary?: CustomDictionary;
  sitePolicies?: SitePolicies;
}

export type BackupImportConflict = 'skip' | 'overwrite' | 'merge';

export interface BackupImportResult {
  ok: boolean;
  message: string;
  backup?: QianCiBackup;
}

/**
 * 构建可导入的完整备份 JSON 对象。
 */
export function buildFullBackup(input: {
  profile: UserProfile;
  vocab: VocabItem[];
  customDictionary: CustomDictionary;
  sitePolicies: SitePolicies;
}): QianCiBackup {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: normalizeProfile(input.profile),
    vocab: input.vocab,
    customDictionary: input.customDictionary,
    sitePolicies: normalizeSitePolicies(input.sitePolicies)
  };
}

/**
 * 解析并校验备份 JSON 文本。
 *
 * @param raw 用户选择的文件内容。
 * @returns 校验结果；失败时不抛异常。
 */
export function parseBackupJson(raw: string): BackupImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: '备份文件不是合法 JSON' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: '备份文件格式无效' };
  }

  const data = parsed as Partial<QianCiBackup> & {
    words?: VocabItem[];
    items?: VocabItem[];
    format?: string;
  };
  // 完整备份用 formatVersion；旧生词 JSON 用 format: qianci-vocab-json-v1。
  const isLegacyVocabExport = data.format === 'qianci-vocab-json-v1' || Array.isArray(data.items);
  const formatVersion = data.formatVersion ?? (isLegacyVocabExport ? BACKUP_FORMAT_VERSION : undefined);
  if (formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, message: `不支持的备份版本：${String(formatVersion ?? 'unknown')}` };
  }

  const vocabSource = Array.isArray(data.vocab)
    ? data.vocab
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.words)
        ? data.words
        : undefined;

  const vocab = vocabSource
    ? vocabSource
        .filter(
          (item): item is VocabItem =>
            Boolean(
              item &&
                typeof item === 'object' &&
                typeof (item as VocabItem).word === 'string' &&
                typeof (item as VocabItem).translation === 'string'
            )
        )
        .map((item) => ({
          word: item.word.trim().toLowerCase(),
          translation: item.translation,
          lastSeenAt: typeof item.lastSeenAt === 'number' ? item.lastSeenAt : Date.now(),
          lookupCount: typeof item.lookupCount === 'number' ? item.lookupCount : 1
        }))
    : undefined;

  const backup: QianCiBackup = {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
    profile: data.profile ? normalizeProfile(data.profile) : undefined,
    vocab,
    customDictionary:
      data.customDictionary && typeof data.customDictionary === 'object'
        ? (data.customDictionary as CustomDictionary)
        : undefined,
    sitePolicies: data.sitePolicies ? normalizeSitePolicies(data.sitePolicies) : undefined
  };

  if (!backup.profile && !backup.vocab && !backup.customDictionary && !backup.sitePolicies) {
    return { ok: false, message: '备份里没有可导入的学习数据' };
  }

  return { ok: true, message: '备份校验通过', backup };
}

/**
 * 按冲突策略合并生词表。
 */
export function mergeVocabLists(
  current: VocabItem[],
  incoming: VocabItem[],
  conflict: BackupImportConflict
): VocabItem[] {
  if (conflict === 'overwrite') {
    return [...incoming];
  }

  const map = new Map(current.map((item) => [item.word, item]));
  for (const item of incoming) {
    const existing = map.get(item.word);
    if (!existing) {
      map.set(item.word, item);
      continue;
    }
    if (conflict === 'skip') {
      continue;
    }
    // merge：保留更高 lookupCount 与更新的 lastSeenAt
    map.set(item.word, {
      word: item.word,
      translation: item.translation || existing.translation,
      lastSeenAt: Math.max(existing.lastSeenAt, item.lastSeenAt),
      lookupCount: Math.max(existing.lookupCount, item.lookupCount)
    });
  }
  return Array.from(map.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
