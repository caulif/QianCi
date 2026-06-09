import type { OfflineDictionaryTier } from './types';

export interface OfflineDictionaryPackOption {
  tier: OfflineDictionaryTier;
  label: string;
  description: string;
  entries: number;
}

export const DEFAULT_OFFLINE_DICTIONARY_TIER: OfflineDictionaryTier = 'extended';

export const OFFLINE_DICTIONARY_PACK_OPTIONS: OfflineDictionaryPackOption[] = [
  {
    tier: 'core',
    label: '基础',
    description: '覆盖常见阅读和四六级词汇，默认轻量加载。',
    entries: 9000
  },
  {
    tier: 'extended',
    label: '进阶',
    description: '默认档位，兼顾体积和常见难词释义。',
    entries: 23000
  },
  {
    tier: 'deep',
    label: '深度',
    description: '扩展原著、论文和长尾阅读词。',
    entries: 40000
  },
  {
    tier: 'full',
    label: '完整',
    description: '启用当前离线词库里的全部可用词条。',
    entries: 60000
  }
];

const OFFLINE_DICTIONARY_TIER_ORDER = OFFLINE_DICTIONARY_PACK_OPTIONS.map((option) => option.tier);

/**
 * 规范化离线词典档位，避免旧版本或损坏存储值影响加载。
 *
 * @param value 从用户配置读取的原始档位。
 * @returns 支持的离线词典档位。
 */
export function normalizeOfflineDictionaryTier(value: unknown): OfflineDictionaryTier {
  return OFFLINE_DICTIONARY_TIER_ORDER.includes(value as OfflineDictionaryTier)
    ? (value as OfflineDictionaryTier)
    : DEFAULT_OFFLINE_DICTIONARY_TIER;
}

/**
 * 获取指定档位需要启用的递进词典包。
 *
 * @param tier 用户选择的最大离线词典档位。
 * @returns 从基础包到目标档位的包列表。
 */
export function offlineDictionaryTiersUpTo(tier: OfflineDictionaryTier): OfflineDictionaryTier[] {
  const safeTier = normalizeOfflineDictionaryTier(tier);
  const endIndex = OFFLINE_DICTIONARY_TIER_ORDER.indexOf(safeTier);
  return OFFLINE_DICTIONARY_TIER_ORDER.slice(0, endIndex + 1);
}
