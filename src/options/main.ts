import './styles.css';
import {
  applyKnownFeedback,
  createProfile,
  DEFAULT_FEEDBACK_SETTINGS,
  DEFAULT_ANNOTATION_DENSITY,
  isOnlineLookupEnabled,
  LOOKUP_TRIGGERS,
  MANUAL_SHORTCUTS,
  markWordAlwaysAnnotate,
  MAX_ANNOTATION_DENSITY,
  MIN_ANNOTATION_DENSITY,
  normalizeAnnotationDensity,
  resetAllSkipFeedback,
  resetSkipFeedback,
  SUPPRESSION_MODE_SETTINGS,
  unmarkWordAlwaysAnnotate,
  UNDERLINE_TONES
} from '../core/profile';
import {
  createCustomDictionaryPanel,
  listUserCustomEntries,
  normalizeCustomEntryInput
} from './customDictionaryPanel';
import {
  BACKUP_FORMAT_VERSION,
  buildFullBackup,
  mergeVocabLists,
  parseBackupJson,
  type BackupImportConflict
} from '../core/backup';
import {
  DEFAULT_OFFLINE_DICTIONARY_TIER,
  OFFLINE_DICTIONARY_PACK_OPTIONS,
  normalizeOfflineDictionaryTier
} from '../core/dictionaryPacks';
import type {
  FeedbackSettings,
  LookupTrigger,
  ManualShortcut,
  OfflineDictionaryTier,
  SitePolicies,
  SuppressionMode,
  UnderlineTone,
  UserLevel
} from '../core/types';
import type { VocabItem } from '../storage/vocabStore';
import { createChromeStorageAdapter, createMemoryStore, type KeyValueStore } from '../storage/browserAdapter';
import {
  loadOnlineLookupQueue,
  saveOnlineLookupQueue,
  type OnlineLookupQueueItem
} from '../storage/onlineLookupQueueStore';
import {
  loadCustomDictionary,
  removeCustomDictionaryEntry,
  saveCustomDictionary,
  upsertCustomDictionary,
  type CustomDictionary
} from '../storage/customDictionaryStore';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { loadSitePolicies, saveSitePolicies } from '../storage/sitePolicyStore';
import { loadVocab, removeVocabItem, saveVocab } from '../storage/vocabStore';

export interface OptionsState {
  level: UserLevel;
  underlineTone: UnderlineTone;
  lookupTrigger: LookupTrigger;
  manualShortcut: ManualShortcut;
  offlineDictionaryTier?: OfflineDictionaryTier;
  annotationDensity?: number;
  onboardingDismissedAt?: number;
  feedbackSettings?: FeedbackSettings;
  vocab: VocabItem[];
  knownWords: Array<{ word: string; lastSeenAt: number }>;
  weakHiddenCount?: number;
  skippedWords?: Array<{ word: string; familiarity: number; lastSeenAt: number }>;
  alwaysAnnotatedWords?: Array<{ word: string; lastSeenAt: number }>;
  onlineRetryItems?: OnlineLookupQueueItem[];
  onlineCacheCount?: number;
  retryQueueCount?: number;
  sitePolicyCount?: number;
  searchQuery?: string;
  onlineLookupEnabled?: boolean;
  customEntries?: DictionaryEntry[];
  customDraftWord?: string;
  customDraftTranslation?: string;
  customEditingWord?: string;
  customDictionaryMessage?: string;
}

interface OptionsHandlers {
  onLevelChange?: (level: UserLevel) => void | Promise<void>;
  onToneChange?: (tone: UnderlineTone) => void | Promise<void>;
  onLookupTriggerChange?: (trigger: LookupTrigger) => void | Promise<void>;
  onManualShortcutChange?: (shortcut: ManualShortcut) => void | Promise<void>;
  onOfflineDictionaryTierChange?: (tier: OfflineDictionaryTier) => void | Promise<void>;
  onAnnotationDensityChange?: (density: number) => void | Promise<void>;
  onDismissOnboarding?: () => void | Promise<void>;
  onReopenOnboarding?: () => void | Promise<void>;
  onApplyOnboardingPreset?: (preset: { annotationDensity: number; lookupTrigger: LookupTrigger }) => void | Promise<void>;
  onSuppressionModeChange?: (mode: SuppressionMode) => void | Promise<void>;
  onResetSkipFeedback?: () => void | Promise<void>;
  onRestoreSkipFeedback?: (word: string) => void | Promise<void>;
  onAlwaysAnnotate?: (word: string) => void | Promise<void>;
  onUnpinAlwaysAnnotate?: (word: string) => void | Promise<void>;
  onClearOnlineRetryQueue?: () => void | Promise<void>;
  onClearOnlineCache?: () => void | Promise<void>;
  onClearSitePolicies?: () => void | Promise<void>;
  onOnlineLookupEnabledChange?: (enabled: boolean) => void | Promise<void>;
  onSearchChange?: (query: string) => void | Promise<void>;
  onRemoveVocab?: (word: string) => void | Promise<void>;
  onForgetKnown?: (word: string) => void | Promise<void>;
  onMarkVocabKnown?: (word: string) => void | Promise<void>;
  onCustomDraftWordChange?: (word: string) => void | Promise<void>;
  onCustomDraftTranslationChange?: (translation: string) => void | Promise<void>;
  onSaveCustomEntry?: (word: string, translation: string) => void | Promise<void>;
  onDeleteCustomEntry?: (word: string) => void | Promise<void>;
  onStartEditCustomEntry?: (word: string) => void | Promise<void>;
  onExport?: (csv: string) => void | Promise<void>;
  onExportJson?: (json: string) => void | Promise<void>;
  onExportAnki?: (csv: string) => void | Promise<void>;
  onExportFullBackup?: () => void | Promise<void>;
  onImportFullBackup?: (raw: string, conflict: BackupImportConflict) => void | Promise<void>;
}

const LEVELS: Array<{ level: UserLevel; label: string }> = [
  { level: 'starter', label: '入门' },
  { level: 'cet4', label: '四级' },
  { level: 'cet6', label: '六级' },
  { level: 'graduate', label: '考研' },
  { level: 'ielts-toefl', label: '雅思托福' },
  { level: 'professional', label: '专业阅读' }
];

const SUPPRESSION_MODES: Array<{ mode: SuppressionMode; label: string; description: string }> = [
  { mode: 'conservative', label: '更久保留提醒', description: '路过未点开的词更慢被收起' },
  { mode: 'balanced', label: '平衡节奏', description: '保持默认收起节奏' },
  { mode: 'aggressive', label: '更快收起重复词', description: '路过未点开的词更快减少标注' }
];

/**
 * 解析设置页 URL hash，返回应滚动到的元素 id。
 */
export function resolveOptionsSectionTarget(hash: string): string | undefined {
  const cleaned = hash.replace(/^#/, '').trim();
  if (!cleaned) {
    return undefined;
  }
  const known = new Set([
    'section-reading',
    'section-words',
    'section-strategy',
    'section-privacy',
    'custom-dictionary',
    'online-retry'
  ]);
  return known.has(cleaned) ? cleaned : undefined;
}

/**
 * 从完整备份 JSON 解析导入预览文案（不写入存储）。
 */
export function buildBackupImportPreview(raw: string):
  | { ok: true; summary: string; exportedAt?: string }
  | { ok: false; error: string } {
  const parsed = parseBackupJson(raw);
  if (!parsed.ok || !parsed.backup) {
    return { ok: false, error: parsed.message || '备份格式无效' };
  }
  const backup = parsed.backup;
  const vocabCount = backup.vocab?.length ?? 0;
  const customCount = backup.customDictionary
    ? Object.values(backup.customDictionary).filter((entry) => entry.source === 'custom').length
    : 0;
  const onlineCacheCount = backup.customDictionary
    ? Object.values(backup.customDictionary).filter((entry) => entry.source === 'online').length
    : 0;
  const siteCount = backup.sitePolicies ? Object.keys(backup.sitePolicies).length : 0;
  const hasProfile = Boolean(backup.profile);
  const summary = [
    `将写入：生词 ${vocabCount}`,
    `自定义释义 ${customCount}`,
    `联网缓存 ${onlineCacheCount}`,
    `站点策略 ${siteCount}`,
    hasProfile ? '学习画像 1' : '学习画像 0'
  ].join(' · ');
  return { ok: true, summary, exportedAt: backup.exportedAt };
}

const ONLINE_RETRY_ERROR_LABELS: Record<OnlineLookupQueueItem['lastErrorKind'], string> = {
  not_found: '未找到词条',
  network_error: '网络异常',
  timeout: '请求超时',
  service_unavailable: '服务不可用',
  rate_limited: '请求过于频繁',
  parse_error: '响应解析失败'
};

const DENSITY_SLIDER_SCALE = 100;

const ONBOARDING_PRESETS: Array<{
  key: string;
  label: string;
  description: string;
  annotationDensity: number;
  lookupTrigger: LookupTrigger;
}> = [
  {
    key: 'quiet',
    label: '安静阅读',
    description: '少一点标注，点击再看释义',
    annotationDensity: 0.85,
    lookupTrigger: 'click'
  },
  {
    key: 'balanced',
    label: '平衡默认',
    description: '保持平衡密度，悬停快速查词',
    annotationDensity: 1,
    lookupTrigger: 'hover'
  },
  {
    key: 'learning',
    label: '多提醒学习',
    description: '多提醒一点，但不过度铺满页面',
    annotationDensity: 1.15,
    lookupTrigger: 'hover'
  }
];

export function levelLabel(level: UserLevel): string {
  return LEVELS.find((item) => item.level === level)?.label ?? '四级';
}

function levelIndex(level: UserLevel): number {
  return Math.max(0, LEVELS.findIndex((item) => item.level === level));
}

function levelFromIndex(index: number): UserLevel {
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, index))].level;
}

/**
 * 将密度值转换为滑块整数，避免浏览器 range 小数精度差异。
 *
 * @param density 当前标注密度。
 * @returns 适合 range input 的整数值。
 */
function densityToSliderValue(density: number | undefined): string {
  return String(Math.round(normalizeAnnotationDensity(density ?? DEFAULT_ANNOTATION_DENSITY) * DENSITY_SLIDER_SCALE));
}

/**
 * 将滑块整数转换回安全密度值。
 *
 * @param value range input 的字符串值。
 * @returns 限制在 0.75 到 1.25 内的标注密度。
 */
function densityFromSliderValue(value: string): number {
  return normalizeAnnotationDensity(Number(value) / DENSITY_SLIDER_SCALE);
}

/**
 * 用用户语言描述当前标注密度。
 *
 * @param density 当前标注密度。
 * @returns 设置页徽标文案。
 */
function densityLabel(density: number | undefined): string {
  const safeDensity = normalizeAnnotationDensity(density ?? DEFAULT_ANNOTATION_DENSITY);
  if (safeDensity < 0.95) {
    return '少标一些';
  }
  if (safeDensity > 1.05) {
    return '多标一些';
  }
  return '平衡';
}

/**
 * 生成标注密度的辅助说明文案。
 *
 * @param density 当前标注密度。
 * @returns 面向普通用户的说明。
 */
function densityDescription(density: number | undefined): string {
  const safeDensity = normalizeAnnotationDensity(density ?? DEFAULT_ANNOTATION_DENSITY);
  return `${densityLabel(safeDensity)} · ${Math.round(safeDensity * 100)}%`;
}

export function buildVocabCsv(vocab: VocabItem[]): string {
  const rows = ['word,translation,lastSeenAt,lookupCount'];
  for (const item of vocab) {
    rows.push([item.word, item.translation, String(item.lastSeenAt), String(item.lookupCount)].map(escapeCsv).join(','));
  }
  return rows.join('\n');
}

/**
 * 构建适合 Anki 文本导入的三列 CSV。
 *
 * @param vocab 当前保存的生词列表。
 * @returns front、back、tags 三列组成的 CSV 字符串。
 */
export function buildVocabAnkiCsv(vocab: VocabItem[]): string {
  const rows = ['#separator:Comma', '#html:false', '#columns:Front,Back,Tags', '#tags column:3'];
  for (const item of vocab) {
    rows.push([item.word, item.translation, `qianci lookup_${item.lookupCount}`].map(escapeCsv).join(','));
  }
  return rows.join('\n');
}

/**
 * 构建可迁移的生词 JSON 导出内容。
 *
 * @param vocab 当前保存的生词列表。
 * @returns 带格式版本和导出时间的 JSON 字符串。
 */
export function buildVocabJson(vocab: VocabItem[]): string {
  return JSON.stringify(
    {
      format: 'qianci-vocab-json-v1',
      exportedAt: new Date().toISOString(),
      items: vocab.map((item) => ({
        word: item.word,
        translation: item.translation,
        lastSeenAt: item.lastSeenAt,
        lookupCount: item.lookupCount
      }))
    },
    null,
    2
  );
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * 下载指定文本内容。
 *
 * @param content 要写入文件的文本内容。
 * @param mimeType 文件 MIME 类型。
 * @param extension 下载文件扩展名。
 */
function downloadTextFile(
  content: string,
  mimeType: string,
  extension: 'csv' | 'json',
  basename = 'qianci-vocab'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${basename}-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(csv: string): void {
  downloadTextFile(csv, 'text/csv;charset=utf-8', 'csv');
}

/**
 * 下载生词 JSON 备份文件。
 *
 * @param json 已格式化的 JSON 导出内容。
 */
function downloadJson(json: string): void {
  downloadTextFile(json, 'application/json;charset=utf-8', 'json');
}

/**
 * 将下次重试时间转成用户能快速理解的相对文案。
 *
 * @param retryAt 下次重试的时间戳。
 * @param now 当前时间戳。
 * @returns 面向设置页展示的相对时间。
 */
function formatRetryTime(retryAt: number, now: number): string {
  const remainingMs = retryAt - now;
  if (remainingMs <= 0) {
    return '稍后重试';
  }

  const remainingMinutes = Math.ceil(remainingMs / 60_000);
  if (remainingMinutes < 60) {
    return `${remainingMinutes} 分钟后`;
  }

  const remainingHours = Math.ceil(remainingMinutes / 60);
  return `${remainingHours} 小时后`;
}

/**
 * 按下次重试时间排序，避免设置页里的队列顺序跳动。
 *
 * @param items 联网重试队列条目。
 * @returns 排序后的新数组。
 */
function sortOnlineRetryItems(items: OnlineLookupQueueItem[] = []): OnlineLookupQueueItem[] {
  return [...items].sort((left, right) => left.nextRetryAt - right.nextRetryAt || left.word.localeCompare(right.word));
}

/**
 * 创建联网补查重试队列面板。
 *
 * @param onlineRetryItems 已排序的联网重试条目。
 * @param handlers 设置页事件处理器。
 * @returns 可直接插入设置页的面板元素。
 */
function createOnlineRetryPanel(onlineRetryItems: OnlineLookupQueueItem[], handlers: OptionsHandlers): HTMLElement {
  const retryPanel = document.createElement('section');
  retryPanel.className = 'panel retry-panel';
  retryPanel.id = 'online-retry';

  const retryHeader = document.createElement('div');
  retryHeader.className = 'panel-toolbar';
  const retryTitle = document.createElement('div');
  retryTitle.className = 'panel-title';
  retryTitle.textContent = '联网补查重试队列';
  retryHeader.append(retryTitle);

  if (onlineRetryItems.length > 0) {
    const clearRetryButton = document.createElement('button');
    clearRetryButton.type = 'button';
    clearRetryButton.className = 'row-action-button';
    clearRetryButton.dataset.qianciClearRetryQueue = 'true';
    clearRetryButton.textContent = '清空重试队列';
    clearRetryButton.addEventListener('click', () => {
      void handlers.onClearOnlineRetryQueue?.();
    });
    retryHeader.append(clearRetryButton);
  }
  retryPanel.append(retryHeader);

  const retryDescription = document.createElement('p');
  retryDescription.className = 'panel-copy';
  retryDescription.textContent =
    onlineRetryItems.length > 0
      ? `还有 ${onlineRetryItems.length} 个词等待联网补查重试`
      : '暂无待重试的联网补查';
  retryPanel.append(retryDescription);

  if (onlineRetryItems.length > 0) {
    const retryList = document.createElement('div');
    retryList.className = 'retry-list';
    const now = Date.now();

    for (const item of onlineRetryItems.slice(0, 8)) {
      const retryItem = document.createElement('div');
      retryItem.className = 'retry-item';

      const word = document.createElement('strong');
      word.textContent = item.word;

      const meta = document.createElement('span');
      meta.textContent = `${ONLINE_RETRY_ERROR_LABELS[item.lastErrorKind]} · 第 ${item.attempts}/3 次 · 下次重试 ${formatRetryTime(
        item.nextRetryAt,
        now
      )}`;

      retryItem.append(word, meta);
      retryList.append(retryItem);
    }

    retryPanel.append(retryList);
  }

  return retryPanel;
}

/**
 * 创建数据与隐私说明面板。
 *
 * @param state 当前设置页状态。
 * @param handlers 设置页事件处理器。
 * @returns 数据与隐私面板元素。
 */
function createPrivacyPanel(state: OptionsState, handlers: OptionsHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel privacy-panel';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '数据与隐私';
  panel.append(title);

  const summary = document.createElement('p');
  summary.className = 'panel-copy';
  summary.textContent = `生词 ${state.vocab.length} 个 · 熟词 ${state.knownWords.length} 个 · 联网缓存 ${
    state.onlineCacheCount ?? 0
  } 个 · 待重试 ${state.retryQueueCount ?? state.onlineRetryItems?.length ?? 0} 个 · 站点设置 ${
    state.sitePolicyCount ?? 0
  } 个`;
  panel.append(summary);

  const localCopy = document.createElement('p');
  localCopy.className = 'panel-copy';
  localCopy.textContent = '这些操作只清理本机扩展数据，不会影响浏览器历史或已导出的文件。';
  panel.append(localCopy);

  const onlineCopy = document.createElement('p');
  onlineCopy.className = 'panel-copy';
  onlineCopy.textContent = isOnlineLookupEnabled({ onlineLookupEnabled: state.onlineLookupEnabled })
    ? '只有你主动联网补查时，潜词才会发送单个单词。'
    : '已关闭联网补查：本地查词和标注不受影响，也不会向第三方发送单词。';
  panel.append(onlineCopy);

  const onlineToggle = document.createElement('label');
  onlineToggle.className = 'privacy-toggle';
  const onlineCheckbox = document.createElement('input');
  onlineCheckbox.type = 'checkbox';
  onlineCheckbox.dataset.qianciOnlineLookupEnabled = 'true';
  onlineCheckbox.checked = isOnlineLookupEnabled({ onlineLookupEnabled: state.onlineLookupEnabled });
  onlineCheckbox.addEventListener('change', () => {
    void handlers.onOnlineLookupEnabledChange?.(onlineCheckbox.checked);
  });
  const onlineToggleText = document.createElement('span');
  onlineToggleText.textContent = '允许联网补查';
  onlineToggle.append(onlineCheckbox, onlineToggleText);
  panel.append(onlineToggle);

  const actions = document.createElement('div');
  actions.className = 'privacy-actions';

  const clearOnlineCacheButton = document.createElement('button');
  clearOnlineCacheButton.type = 'button';
  clearOnlineCacheButton.className = 'row-action-button';
  clearOnlineCacheButton.dataset.qianciClearOnlineCache = 'true';
  clearOnlineCacheButton.textContent = '清空联网缓存';
  clearOnlineCacheButton.title = '只清除联网补查缓存，不影响你手写的自定义释义与生词表';
  clearOnlineCacheButton.addEventListener('click', () => {
    void handlers.onClearOnlineCache?.();
  });
  actions.append(clearOnlineCacheButton);

  const clearSitePoliciesButton = document.createElement('button');
  clearSitePoliciesButton.type = 'button';
  clearSitePoliciesButton.className = 'row-action-button';
  clearSitePoliciesButton.dataset.qianciClearSitePolicies = 'true';
  clearSitePoliciesButton.textContent = '清空站点设置';
  clearSitePoliciesButton.addEventListener('click', () => {
    void handlers.onClearSitePolicies?.();
  });
  actions.append(clearSitePoliciesButton);

  const exportBackupButton = document.createElement('button');
  exportBackupButton.type = 'button';
  exportBackupButton.className = 'row-action-button';
  exportBackupButton.dataset.qianciExportBackup = 'true';
  exportBackupButton.textContent = '导出完整备份';
  exportBackupButton.addEventListener('click', () => {
    void handlers.onExportFullBackup?.();
  });
  actions.append(exportBackupButton);

  const importBackupButton = document.createElement('button');
  importBackupButton.type = 'button';
  importBackupButton.className = 'row-action-button';
  importBackupButton.dataset.qianciImportBackup = 'true';
  importBackupButton.textContent = '导入备份';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  importInput.dataset.qianciImportBackupInput = 'true';
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      const preview = buildBackupImportPreview(raw);
      if (!preview.ok) {
        window.alert(preview.error);
        importInput.value = '';
        return;
      }
      const acceptPreview = window.confirm(
        `${preview.summary}\n导出时间：${preview.exportedAt ?? '未知'}\n\n导入会写入本机数据，不会上传。是否继续选择冲突策略？`
      );
      if (!acceptPreview) {
        importInput.value = '';
        return;
      }
      const conflict = window.confirm(
        '生词冲突时：点“确定”合并（保留更高查看次数）；点“取消”则跳过冲突词。'
      )
        ? 'merge'
        : 'skip';
      void handlers.onImportFullBackup?.(raw, conflict as BackupImportConflict);
      importInput.value = '';
    };
    reader.readAsText(file);
  });
  importBackupButton.addEventListener('click', () => {
    importInput.click();
  });
  actions.append(importBackupButton, importInput);

  panel.append(actions);

  const cacheNote = document.createElement('p');
  cacheNote.className = 'panel-copy';
  cacheNote.dataset.qianciCacheVsCustom = 'true';
  cacheNote.textContent =
    '联网缓存与「自定义释义」分开：清空联网缓存不会删除你改过的释义；自定义释义在「我的词」中管理。';
  panel.append(cacheNote);
  return panel;
}

/**
 * 移除联网补查产生的缓存，保留用户自定义词条。
 *
 * @param dictionary 当前自定义词典和联网缓存。
 * @returns 仅保留非联网来源的词典。
 */
function removeOnlineDictionaryEntries(dictionary: CustomDictionary): CustomDictionary {
  return Object.fromEntries(Object.entries(dictionary).filter(([, entry]) => entry.source !== 'online'));
}

/**
 * 统计联网补查产生的缓存数量，不包含用户自定义词条。
 *
 * @param dictionary 当前自定义词典和联网缓存。
 * @returns 联网缓存条目数。
 */
function countOnlineDictionaryEntries(dictionary: CustomDictionary): number {
  return Object.values(dictionary).filter((entry) => entry.source === 'online').length;
}

/**
 * 创建一个学习回顾卡片，帮助用户从原始词表中看到下一步任务。
 *
 * @param title 卡片标题。
 * @param body 卡片主体文案。
 * @returns 学习回顾卡片元素。
 */
function createReviewCard(title: string, body: string, action?: { label: string; word: string; onClick: () => void }): HTMLElement {
  const card = document.createElement('div');
  card.className = 'review-card';

  const heading = document.createElement('div');
  heading.className = 'review-card-title';
  heading.textContent = title;
  card.append(heading);

  const copy = document.createElement('p');
  copy.className = 'review-card-copy';
  copy.textContent = body;
  card.append(copy);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-card-action';
    button.dataset.qianciReviewMarkKnown = action.word;
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    card.append(button);
  }

  return card;
}

/**
 * 创建学习回顾面板，把词表按用户任务重新组织。
 *
 * @param vocab 生词列表。
 * @param knownWords 熟词列表。
 * @returns 学习回顾面板。
 */
function createLearningReviewPanel(
  vocab: VocabItem[],
  knownWords: OptionsState['knownWords'],
  handlers: OptionsHandlers
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel review-panel';
  panel.dataset.qianciReviewPanel = 'true';
  panel.setAttribute('aria-labelledby', 'qianci-learning-review-title');

  const title = document.createElement('h2');
  title.id = 'qianci-learning-review-title';
  title.className = 'panel-title';
  title.textContent = '学习回顾';
  panel.append(title);

  const intro = document.createElement('p');
  intro.className = 'panel-copy';
  intro.textContent = '先看最近与高频生词（最多各 5 个），再进入完整词表。';
  panel.append(intro);

  const recentList = [...vocab].sort((left, right) => right.lastSeenAt - left.lastSeenAt).slice(0, 5);
  const frequentList = [...vocab]
    .sort((left, right) => right.lookupCount - left.lookupCount || right.lastSeenAt - left.lastSeenAt)
    .slice(0, 5);
  const recentKnownList = [...knownWords].sort((left, right) => right.lastSeenAt - left.lastSeenAt).slice(0, 5);

  const appendWordList = (heading: string, items: VocabItem[], withKnownAction: boolean): void => {
    const block = document.createElement('div');
    block.className = 'review-list-block';
    const h = document.createElement('div');
    h.className = 'skip-word-title';
    h.textContent = heading;
    block.append(h);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'panel-copy';
      empty.textContent = '暂无';
      block.append(empty);
      panel.append(block);
      return;
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'skip-word-chip';
      const meta = document.createElement('span');
      meta.textContent =
        item.lookupCount > 0 ? `${item.word} · ${item.lookupCount} 次` : item.word;
      row.append(meta);
      if (withKnownAction) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip-action-button';
        button.dataset.qianciReviewMarkKnown = item.word;
        button.textContent = '标为认识';
        button.addEventListener('click', () => {
          void handlers.onMarkVocabKnown?.(item.word);
        });
        row.append(button);
      }
      block.append(row);
    }
    panel.append(block);
  };

  appendWordList('最近查过', recentList, true);
  appendWordList('查得最多', frequentList, true);

  const knownBlock = document.createElement('div');
  knownBlock.className = 'review-list-block';
  const knownHeading = document.createElement('div');
  knownHeading.className = 'skip-word-title';
  knownHeading.textContent = '最近认识';
  knownBlock.append(knownHeading);
  if (!recentKnownList.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-copy';
    empty.textContent = '暂无';
    knownBlock.append(empty);
  } else {
    for (const item of recentKnownList) {
      const row = document.createElement('div');
      row.className = 'skip-word-chip';
      const meta = document.createElement('span');
      meta.textContent = item.word;
      row.append(meta);
      knownBlock.append(row);
    }
  }
  panel.append(knownBlock);
  return panel;
}

/**
 * 创建首次使用引导面板，帮助新用户不用读 README 也能开始。
 *
 * @param state 当前设置页状态。
 * @param handlers 设置页事件处理器。
 * @returns 可插入设置页的引导面板或重开入口。
 */
function createOnboardingPanel(state: OptionsState, handlers: OptionsHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = state.onboardingDismissedAt ? 'panel onboarding-panel onboarding-panel-compact' : 'panel onboarding-panel';

  if (state.onboardingDismissedAt) {
    const row = document.createElement('div');
    row.className = 'panel-toolbar';

    const copy = document.createElement('div');
    copy.className = 'panel-title';
    copy.textContent = '需要重新熟悉潜词？';
    row.append(copy);

    const reopenButton = document.createElement('button');
    reopenButton.type = 'button';
    reopenButton.className = 'row-action-button';
    reopenButton.dataset.qianciReopenOnboarding = 'true';
    reopenButton.textContent = '重新打开引导';
    reopenButton.addEventListener('click', () => {
      void handlers.onReopenOnboarding?.();
    });
    row.append(reopenButton);

    panel.append(row);
    return panel;
  }

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '三步开始使用潜词';
  panel.append(title);

  const intro = document.createElement('p');
  intro.className = 'panel-copy';
  intro.textContent = '先用默认设置也可以；这三步帮你理解潜词为什么标、什么时候少标。';
  panel.append(intro);

  const steps = document.createElement('ol');
  steps.className = 'onboarding-steps';
  for (const text of [
    '选择大致英语水平，用来决定初始标注范围。',
    '调节标注密度：少打扰或多提醒，都可以随时改。',
    '看到认识的词就点“认识”；多次未查看的词会逐渐少标，也能恢复提醒。'
  ]) {
    const item = document.createElement('li');
    item.textContent = text;
    steps.append(item);
  }
  panel.append(steps);

  const presetTitle = document.createElement('div');
  presetTitle.className = 'skip-word-title';
  presetTitle.textContent = '也可以直接选一个开始方式';
  panel.append(presetTitle);

  const presetList = document.createElement('div');
  presetList.className = 'onboarding-presets';
  for (const preset of ONBOARDING_PRESETS) {
    const presetButton = document.createElement('button');
    presetButton.type = 'button';
    presetButton.className = 'onboarding-preset-button';
    presetButton.dataset.qianciOnboardingPreset = preset.key;
    presetButton.textContent = preset.label;

    const description = document.createElement('span');
    description.textContent = preset.description;
    presetButton.append(description);

    presetButton.addEventListener('click', () => {
      void handlers.onApplyOnboardingPreset?.({
        annotationDensity: preset.annotationDensity,
        lookupTrigger: preset.lookupTrigger
      });
    });
    presetList.append(presetButton);
  }
  panel.append(presetList);

  const actions = document.createElement('div');
  actions.className = 'onboarding-actions';

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'row-action-button';
  dismissButton.dataset.qianciDismissOnboarding = 'true';
  dismissButton.textContent = '知道了';
  dismissButton.addEventListener('click', () => {
    void handlers.onDismissOnboarding?.();
  });
  actions.append(dismissButton);

  panel.append(actions);
  return panel;
}

export function renderOptions(root: HTMLElement, state: OptionsState, handlers: OptionsHandlers = {}): void {
  root.innerHTML = '';
  const searchQuery = state.searchQuery?.trim().toLowerCase() ?? '';
  const feedbackSettings = state.feedbackSettings ?? DEFAULT_FEEDBACK_SETTINGS;
  const annotationDensity = normalizeAnnotationDensity(state.annotationDensity ?? DEFAULT_ANNOTATION_DENSITY);
  const offlineDictionaryTier = normalizeOfflineDictionaryTier(
    state.offlineDictionaryTier ?? DEFAULT_OFFLINE_DICTIONARY_TIER
  );
  const matchesQuery = (word: string, translation = '') =>
    !searchQuery || `${word} ${translation}`.toLowerCase().includes(searchQuery);
  const filteredVocab = state.vocab.filter((item) => matchesQuery(item.word, item.translation));
  const filteredKnownWords = state.knownWords.filter((item) => matchesQuery(item.word));
  const onlineRetryItems = sortOnlineRetryItems(state.onlineRetryItems);

  const shell = document.createElement('section');
  shell.className = 'options-shell';

  const header = document.createElement('header');
  header.className = 'options-header';
  header.innerHTML = `
    <div>
      <h1>潜词</h1>
      <p>安静标出生词，越用越懂你</p>
    </div>
  `;
  shell.append(header);

  const nav = document.createElement('nav');
  nav.className = 'options-nav';
  nav.setAttribute('aria-label', '设置分组');
  nav.dataset.qianciOptionsNav = 'true';
  for (const item of [
    { id: 'section-reading', label: '阅读设置' },
    { id: 'section-words', label: '我的词' },
    { id: 'section-strategy', label: '标注策略' },
    { id: 'section-privacy', label: '数据与隐私' }
  ] as const) {
    const link = document.createElement('a');
    link.href = `#${item.id}`;
    link.className = 'options-nav-link';
    link.dataset.qianciSectionLink = item.id;
    link.textContent = item.label;
    link.addEventListener('click', () => {
      for (const node of nav.querySelectorAll('.options-nav-link')) {
        node.classList.remove('is-active');
      }
      link.classList.add('is-active');
    });
    nav.append(link);
  }
  shell.append(nav);

  const readingSection = document.createElement('section');
  readingSection.id = 'section-reading';
  readingSection.className = 'options-section';
  readingSection.dataset.qianciSection = 'reading';
  const readingTitle = document.createElement('h2');
  readingTitle.className = 'options-section-title';
  readingTitle.textContent = '阅读设置';
  readingSection.append(readingTitle);

  const wordsSection = document.createElement('section');
  wordsSection.id = 'section-words';
  wordsSection.className = 'options-section';
  wordsSection.dataset.qianciSection = 'words';
  const wordsTitle = document.createElement('h2');
  wordsTitle.className = 'options-section-title';
  wordsTitle.textContent = '我的词';
  wordsSection.append(wordsTitle);

  const strategySection = document.createElement('section');
  strategySection.id = 'section-strategy';
  strategySection.className = 'options-section';
  strategySection.dataset.qianciSection = 'strategy';
  const strategyTitle = document.createElement('h2');
  strategyTitle.className = 'options-section-title';
  strategyTitle.textContent = '标注策略';
  strategySection.append(strategyTitle);

  const privacySection = document.createElement('section');
  privacySection.id = 'section-privacy';
  privacySection.className = 'options-section';
  privacySection.dataset.qianciSection = 'privacy';
  const privacyTitle = document.createElement('h2');
  privacyTitle.className = 'options-section-title';
  privacyTitle.textContent = '数据与隐私';
  privacySection.append(privacyTitle);

  readingSection.append(createOnboardingPanel(state, handlers));
  wordsSection.append(createLearningReviewPanel(state.vocab, state.knownWords, handlers));

  const searchPanel = document.createElement('section');
  searchPanel.className = 'panel';
  const searchTitle = document.createElement('div');
  searchTitle.className = 'panel-title';
  searchTitle.textContent = '词表检索';
  searchPanel.append(searchTitle);

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'search-input';
  searchInput.placeholder = '搜生词、熟词或自定义释义';
  searchInput.value = state.searchQuery ?? '';
  searchInput.setAttribute('aria-label', '搜索词表与自定义释义');
  searchInput.addEventListener('input', () => {
    void handlers.onSearchChange?.(searchInput.value);
  });
  const searchHint = document.createElement('p');
  searchHint.className = 'panel-copy';
  searchHint.textContent = '检索范围：生词表、熟词表、自定义释义。';
  searchPanel.append(searchInput, searchHint);
  wordsSection.append(searchPanel);

  const filteredCustomEntries = (state.customEntries ?? []).filter((entry) =>
    matchesQuery(entry.word, entry.translation)
  );
  wordsSection.append(
    createCustomDictionaryPanel(
      {
        entries: filteredCustomEntries,
        draftWord: state.customDraftWord,
        draftTranslation: state.customDraftTranslation,
        editingWord: state.customEditingWord
      },
      {
        onDraftWordChange: handlers.onCustomDraftWordChange,
        onDraftTranslationChange: handlers.onCustomDraftTranslationChange,
        onSaveCustomEntry: handlers.onSaveCustomEntry,
        onDeleteCustomEntry: handlers.onDeleteCustomEntry,
        onStartEditCustomEntry: handlers.onStartEditCustomEntry
      }
    )
  );
  if (state.customDictionaryMessage) {
    const customMessage = document.createElement('p');
    customMessage.className = 'panel-copy custom-dictionary-message';
    customMessage.setAttribute('role', 'status');
    customMessage.textContent = state.customDictionaryMessage;
    wordsSection.append(customMessage);
  }

  const levelPanel = document.createElement('section');
  levelPanel.className = 'panel';
  const levelTitle = document.createElement('div');
  levelTitle.className = 'panel-title';
  levelTitle.textContent = '初始词汇水位线';
  levelPanel.append(levelTitle);

  const levelRow = document.createElement('div');
  levelRow.className = 'level-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(LEVELS.length - 1);
  slider.step = '1';
  slider.value = String(levelIndex(state.level));

  const badge = document.createElement('span');
  badge.className = 'level-badge';
  badge.textContent = levelLabel(state.level);

  slider.addEventListener('input', () => {
    const nextLevel = levelFromIndex(Number(slider.value));
    badge.textContent = levelLabel(nextLevel);
    void handlers.onLevelChange?.(nextLevel);
  });

  levelRow.append(slider, badge);
  levelPanel.append(levelRow);
  readingSection.append(levelPanel);

  const densityPanel = document.createElement('section');
  densityPanel.className = 'panel density-panel';

  const densityTitle = document.createElement('div');
  densityTitle.className = 'panel-title';
  densityTitle.textContent = '标注密度';
  densityPanel.append(densityTitle);

  const densityCopy = document.createElement('p');
  densityCopy.className = 'panel-copy';
  densityCopy.textContent = '想少打扰就往左，想多提醒就往右。';
  densityPanel.append(densityCopy);

  const densityRow = document.createElement('div');
  densityRow.className = 'level-row';

  const densitySlider = document.createElement('input');
  densitySlider.type = 'range';
  densitySlider.min = String(MIN_ANNOTATION_DENSITY * DENSITY_SLIDER_SCALE);
  densitySlider.max = String(MAX_ANNOTATION_DENSITY * DENSITY_SLIDER_SCALE);
  densitySlider.step = '5';
  densitySlider.value = densityToSliderValue(annotationDensity);
  densitySlider.dataset.qianciAnnotationDensity = 'true';
  densitySlider.setAttribute('aria-label', '标注密度');

  const densityBadge = document.createElement('span');
  densityBadge.className = 'level-badge';
  densityBadge.textContent = densityLabel(annotationDensity);

  const densityMeta = document.createElement('p');
  densityMeta.className = 'panel-copy';
  densityMeta.textContent = densityDescription(annotationDensity);

  densitySlider.addEventListener('input', () => {
    const nextDensity = densityFromSliderValue(densitySlider.value);
    densityBadge.textContent = densityLabel(nextDensity);
    densityMeta.textContent = densityDescription(nextDensity);
    void handlers.onAnnotationDensityChange?.(nextDensity);
  });

  densityRow.append(densitySlider, densityBadge);
  densityPanel.append(densityRow, densityMeta);
  readingSection.append(densityPanel);

  const dictionaryPanel = document.createElement('section');
  dictionaryPanel.className = 'panel dictionary-pack-panel';

  const dictionaryTitle = document.createElement('div');
  dictionaryTitle.className = 'panel-title';
  dictionaryTitle.textContent = '离线词库';
  dictionaryPanel.append(dictionaryTitle);

  const dictionaryCopy = document.createElement('p');
  dictionaryCopy.className = 'panel-copy';
  dictionaryCopy.textContent = '进阶包默认加载；想更轻或更全，可以按自己的阅读场景调整。';
  dictionaryPanel.append(dictionaryCopy);

  const dictionaryChoices = document.createElement('div');
  dictionaryChoices.className = 'dictionary-pack-grid';

  for (const option of OFFLINE_DICTIONARY_PACK_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dictionary-pack-button';
    button.dataset.qianciOfflineDictionaryTier = option.tier;
    button.setAttribute('aria-pressed', String(offlineDictionaryTier === option.tier));

    const label = document.createElement('strong');
    label.textContent = option.label;
    button.append(label);

    const meta = document.createElement('span');
    meta.textContent = `约 ${option.entries.toLocaleString()} 词`;
    button.append(meta);

    const description = document.createElement('small');
    description.textContent = option.description;
    button.append(description);

    button.addEventListener('click', () => {
      void handlers.onOfflineDictionaryTierChange?.(option.tier);
    });

    dictionaryChoices.append(button);
  }

  dictionaryPanel.append(dictionaryChoices);
  readingSection.append(dictionaryPanel);

  const feedbackPanel = document.createElement('section');
  feedbackPanel.className = 'panel feedback-panel';

  const feedbackTitle = document.createElement('div');
  feedbackTitle.className = 'panel-title';
  feedbackTitle.textContent = '标注策略';
  feedbackPanel.append(feedbackTitle);

  const feedbackDescription = document.createElement('p');
  feedbackDescription.className = 'panel-copy';
  feedbackDescription.dataset.qianciWeakFeedbackExplain = 'true';
  feedbackDescription.textContent =
    '路过未点开释义的词会累计「跳过」次数；达到阈值后暂时不再标注。可在下方列表恢复提醒，或设为「总是提醒」避免再被收起。这与弹窗里「本站少标一点」不是同一件事。';
  feedbackPanel.append(feedbackDescription);

  const feedbackMeta = document.createElement('div');
  feedbackMeta.className = 'feedback-meta';
  feedbackMeta.dataset.qianciWeakHiddenCount = String(state.weakHiddenCount ?? 0);
  feedbackMeta.textContent = `当前因路过被收起：${state.weakHiddenCount ?? 0} 个词`;
  feedbackPanel.append(feedbackMeta);

  const feedbackModes = document.createElement('div');
  feedbackModes.className = 'choice-row';
  for (const item of SUPPRESSION_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.dataset.qianciSuppressionMode = item.mode;
    button.title = item.description;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(feedbackSettings.suppressionMode === item.mode));
    button.addEventListener('click', () => {
      void handlers.onSuppressionModeChange?.(item.mode);
    });
    feedbackModes.append(button);
  }
  feedbackPanel.append(feedbackModes);

  if (state.skippedWords?.length) {
    const skippedList = document.createElement('div');
    skippedList.className = 'skip-word-list';
    const skippedTitle = document.createElement('div');
    skippedTitle.className = 'skip-word-title';
    skippedTitle.textContent = '最近被你跳过的词';
    skippedList.append(skippedTitle);

    for (const item of state.skippedWords.slice(0, 3)) {
      const skippedItem = document.createElement('div');
      skippedItem.className = 'skip-word-chip';

      const skippedMeta = document.createElement('span');
      skippedMeta.textContent = `${item.word} · 跳过 ${item.familiarity} 次`;
      skippedItem.append(skippedMeta);

      const restoreButton = document.createElement('button');
      restoreButton.type = 'button';
      restoreButton.className = 'chip-action-button';
      restoreButton.dataset.qianciRestoreSkipFeedback = item.word;
      restoreButton.textContent = '恢复提醒';
      restoreButton.addEventListener('click', () => {
        void handlers.onRestoreSkipFeedback?.(item.word);
      });
      skippedItem.append(restoreButton);

      const alwaysButton = document.createElement('button');
      alwaysButton.type = 'button';
      alwaysButton.className = 'chip-action-button';
      alwaysButton.dataset.qianciAlwaysAnnotate = item.word;
      alwaysButton.textContent = '总是提醒';
      alwaysButton.addEventListener('click', () => {
        void handlers.onAlwaysAnnotate?.(item.word);
      });
      skippedItem.append(alwaysButton);

      skippedList.append(skippedItem);
    }
    feedbackPanel.append(skippedList);
  }

  if (state.alwaysAnnotatedWords?.length) {
    const alwaysList = document.createElement('div');
    alwaysList.className = 'skip-word-list';
    const alwaysTitle = document.createElement('div');
    alwaysTitle.className = 'skip-word-title';
    alwaysTitle.textContent = '总是提醒的词';
    alwaysList.append(alwaysTitle);

    for (const item of state.alwaysAnnotatedWords.slice(0, 6)) {
      const alwaysItem = document.createElement('div');
      alwaysItem.className = 'skip-word-chip';

      const word = document.createElement('span');
      word.textContent = item.word;
      alwaysItem.append(word);

      const unpinButton = document.createElement('button');
      unpinButton.type = 'button';
      unpinButton.className = 'chip-action-button';
      unpinButton.dataset.qianciUnpinAlwaysAnnotate = item.word;
      unpinButton.textContent = '取消固定提醒';
      unpinButton.addEventListener('click', () => {
        void handlers.onUnpinAlwaysAnnotate?.(item.word);
      });
      alwaysItem.append(unpinButton);

      alwaysList.append(alwaysItem);
    }

    feedbackPanel.append(alwaysList);
  }

  const resetSkipButton = document.createElement('button');
  resetSkipButton.type = 'button';
  resetSkipButton.className = 'row-action-button';
  resetSkipButton.dataset.qianciResetSkipFeedback = 'true';
  resetSkipButton.textContent = '重置弱反馈';
  resetSkipButton.addEventListener('click', () => {
    void handlers.onResetSkipFeedback?.();
  });
  feedbackPanel.append(resetSkipButton);
  strategySection.append(feedbackPanel);
  privacySection.append(createOnlineRetryPanel(onlineRetryItems, handlers));
  const privacyPanel = createPrivacyPanel(state, handlers);
  const exportHelp = document.createElement('p');
  exportHelp.className = 'panel-copy';
  exportHelp.textContent =
    '换电脑带走全部记录请用“导出完整备份”；只要生词表给 Anki/表格请用生词区的 Anki/CSV/JSON。';
  privacyPanel.append(exportHelp);
  privacySection.append(privacyPanel);

  const triggerPanel = document.createElement('section');
  triggerPanel.className = 'panel';
  const triggerTitle = document.createElement('div');
  triggerTitle.className = 'panel-title';
  triggerTitle.textContent = '触发方式';
  triggerPanel.append(triggerTitle);

  const triggerHint = document.createElement('p');
  triggerHint.className = 'panel-copy';
  triggerHint.textContent =
    '路过就弹？改成「点击」。触控或无悬停设备会自动倾向点击查词。';
  triggerPanel.append(triggerHint);

  const triggerRow = document.createElement('div');
  triggerRow.className = 'choice-row';

  for (const item of LOOKUP_TRIGGERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.dataset.qianciLookupTrigger = item.trigger;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(state.lookupTrigger === item.trigger));
    button.addEventListener('click', () => {
      void handlers.onLookupTriggerChange?.(item.trigger);
    });
    triggerRow.append(button);
  }

  triggerPanel.append(triggerRow);
  readingSection.append(triggerPanel);

  const tonePanel = document.createElement('section');
  tonePanel.className = 'panel';
  const toneTitle = document.createElement('div');
  toneTitle.className = 'panel-title';
  toneTitle.textContent = '划线颜色';
  tonePanel.append(toneTitle);

  const toneRow = document.createElement('div');
  toneRow.className = 'tone-row';

  for (const tone of UNDERLINE_TONES) {
    const toneButton = document.createElement('button');
    toneButton.type = 'button';
    toneButton.className = 'tone-button';
    toneButton.dataset.qianciTone = tone.tone;
    toneButton.title = tone.label;
    toneButton.setAttribute('aria-label', tone.label);
    toneButton.setAttribute('aria-pressed', String(state.underlineTone === tone.tone));
    if (state.underlineTone === tone.tone) {
      toneButton.dataset.selected = 'true';
    }

    const swatch = document.createElement('span');
    swatch.className = 'tone-swatch';
    swatch.style.background = tone.color;
    toneButton.append(swatch);

    const label = document.createElement('span');
    label.className = 'tone-label';
    label.textContent = tone.label;
    toneButton.append(label);

    toneButton.addEventListener('click', () => {
      void handlers.onToneChange?.(tone.tone);
    });

    toneRow.append(toneButton);
  }

  tonePanel.append(toneRow);
  readingSection.append(tonePanel);

  const manualPanel = document.createElement('section');
  manualPanel.className = 'panel';
  const manualTitle = document.createElement('div');
  manualTitle.className = 'panel-title';
  manualTitle.textContent = '手动查词快捷键';
  manualPanel.append(manualTitle);

  const shortcutRow = document.createElement('div');
  shortcutRow.className = 'choice-row';

  for (const item of MANUAL_SHORTCUTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.dataset.qianciManualShortcut = item.key;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(state.manualShortcut === item.key));
    button.addEventListener('click', () => {
      void handlers.onManualShortcutChange?.(item.key);
    });
    shortcutRow.append(button);
  }

  manualPanel.append(shortcutRow);
  readingSection.append(manualPanel);

  const vocabPanel = document.createElement('section');
  vocabPanel.className = 'panel';
  const vocabHeader = document.createElement('div');
  vocabHeader.className = 'panel-toolbar';

  const vocabTitle = document.createElement('div');
  vocabTitle.className = 'panel-title';
  vocabTitle.textContent = '生词';
  vocabHeader.append(vocabTitle);

  const exportActions = document.createElement('div');
  exportActions.className = 'vocab-export-actions';

  const exportCsvButton = document.createElement('button');
  exportCsvButton.type = 'button';
  exportCsvButton.className = 'icon-button vocab-export-button';
  exportCsvButton.title = '导出 CSV';
  exportCsvButton.setAttribute('aria-label', '导出生词 CSV');
  exportCsvButton.dataset.qianciExportVocab = 'true';
  exportCsvButton.textContent = 'CSV';
  exportCsvButton.addEventListener('click', () => {
    const csv = buildVocabCsv(state.vocab);
    if (handlers.onExport) {
      void handlers.onExport(csv);
      return;
    }
    downloadCsv(csv);
  });

  const exportJsonButton = document.createElement('button');
  exportJsonButton.type = 'button';
  exportJsonButton.className = 'icon-button vocab-export-button';
  exportJsonButton.title = '导出 JSON';
  exportJsonButton.setAttribute('aria-label', '导出生词 JSON');
  exportJsonButton.dataset.qianciExportVocabJson = 'true';
  exportJsonButton.textContent = 'JSON';
  exportJsonButton.addEventListener('click', () => {
    const json = buildVocabJson(state.vocab);
    if (handlers.onExportJson) {
      void handlers.onExportJson(json);
      return;
    }
    downloadJson(json);
  });

  const exportAnkiButton = document.createElement('button');
  exportAnkiButton.type = 'button';
  exportAnkiButton.className = 'icon-button vocab-export-button';
  exportAnkiButton.title = '导出 Anki CSV';
  exportAnkiButton.setAttribute('aria-label', '导出生词 Anki CSV');
  exportAnkiButton.dataset.qianciExportVocabAnki = 'true';
  exportAnkiButton.textContent = 'Anki';
  exportAnkiButton.addEventListener('click', () => {
    const csv = buildVocabAnkiCsv(state.vocab);
    if (handlers.onExportAnki) {
      void handlers.onExportAnki(csv);
      return;
    }
    downloadCsv(csv);
  });

  exportActions.append(exportCsvButton, exportJsonButton, exportAnkiButton);
  vocabHeader.append(exportActions);
  vocabPanel.append(vocabHeader);

  const table = document.createElement('table');
  table.className = 'vocab-table';
  table.innerHTML = `
    <caption>生词列表：包含单词、释义、最近查看日期和操作</caption>
    <thead>
      <tr><th scope="col">Word</th><th scope="col">Meaning</th><th scope="col">Seen</th><th scope="col">操作</th></tr>
    </thead>
  `;
  const body = document.createElement('tbody');
  if (filteredVocab.length) {
    for (const item of filteredVocab) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${item.word}</strong></td>
        <td>${item.translation}</td>
        <td>${new Date(item.lastSeenAt).toLocaleDateString()}</td>
        <td class="row-actions"></td>
      `;
      const actions = row.querySelector('.row-actions');
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'row-action-button';
      removeButton.dataset.qianciRemoveVocab = item.word;
      removeButton.textContent = '移除';
      removeButton.addEventListener('click', () => {
        void handlers.onRemoveVocab?.(item.word);
      });
      actions?.append(removeButton);
      body.append(row);
    }
  } else {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="empty-state">还没有生词</td>';
    body.append(row);
  }
  table.append(body);
  vocabPanel.append(table);
  wordsSection.append(vocabPanel);

  const knownPanel = document.createElement('section');
  knownPanel.className = 'panel';
  const knownTitle = document.createElement('div');
  knownTitle.className = 'panel-title';
  knownTitle.textContent = '熟词';
  knownPanel.append(knownTitle);

  const knownTable = document.createElement('table');
  knownTable.className = 'vocab-table';
  knownTable.innerHTML = `
    <caption>熟词列表：包含单词、最近查看日期和操作</caption>
    <thead>
      <tr><th scope="col">Word</th><th scope="col">Last seen</th><th scope="col">操作</th></tr>
    </thead>
  `;
  const knownBody = document.createElement('tbody');
  if (filteredKnownWords.length) {
    for (const item of filteredKnownWords) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${item.word}</strong></td>
        <td>${new Date(item.lastSeenAt).toLocaleDateString()}</td>
        <td class="row-actions"></td>
      `;
      const actions = row.querySelector('.row-actions');
      const forgetButton = document.createElement('button');
      forgetButton.type = 'button';
      forgetButton.className = 'row-action-button';
      forgetButton.dataset.qianciForgetKnown = item.word;
      forgetButton.textContent = '移出';
      forgetButton.addEventListener('click', () => {
        void handlers.onForgetKnown?.(item.word);
      });
      actions?.append(forgetButton);
      knownBody.append(row);
    }
  } else {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" class="empty-state">还没有熟词</td>';
    knownBody.append(row);
  }
  knownTable.append(knownBody);
  knownPanel.append(knownTable);
  wordsSection.append(knownPanel);

  shell.append(readingSection, wordsSection, strategySection, privacySection);
  root.append(shell);
}

function createDefaultStore(): KeyValueStore {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return createChromeStorageAdapter(chrome.storage.local);
  }
  return createMemoryStore();
}

export async function mountOptionsApp(root: HTMLElement, store = createDefaultStore()): Promise<void> {
  let profile = (await loadProfile(store)) ?? createProfile('cet4');
  let vocab = await loadVocab(store);
  let customDictionary: CustomDictionary = await loadCustomDictionary(store);
  let onlineLookupQueue = await loadOnlineLookupQueue(store);
  let sitePolicies: SitePolicies = await loadSitePolicies(store);
  let searchQuery = '';
  let customDraftWord = '';
  let customDraftTranslation = '';
  let customEditingWord: string | undefined;
  let customDictionaryMessage = '';

  const knownWords = () =>
    Object.entries(profile.words)
      .filter(([, state]) => state.isKnown)
      .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
      .map(([word, state]) => ({ word, lastSeenAt: state.lastSeenAt }));

  const weakHiddenCount = () =>
    Object.values(profile.words).filter(
      (state) => !state.isKnown && state.familiarity >= profile.feedbackSettings.skipLimit
    ).length;

  const skippedWords = () =>
    Object.entries(profile.words)
      .filter(([, state]) => !state.isKnown && !state.alwaysAnnotate && state.familiarity > 0)
      .sort((a, b) => b[1].familiarity - a[1].familiarity || b[1].lastSeenAt - a[1].lastSeenAt)
      .map(([word, state]) => ({ word, familiarity: state.familiarity, lastSeenAt: state.lastSeenAt }));

  const alwaysAnnotatedWords = () =>
    Object.entries(profile.words)
      .filter(([, state]) => !state.isKnown && state.alwaysAnnotate)
      .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
      .map(([word, state]) => ({ word, lastSeenAt: state.lastSeenAt }));

  const applyHashTarget = (): void => {
    if (typeof location === 'undefined') {
      return;
    }
    const targetId = resolveOptionsSectionTarget(location.hash);
    if (!targetId) {
      return;
    }
    const el = root.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.setAttribute('data-qianci-hash-target', 'true');
    }
    const sectionLinkId = targetId.startsWith('section-')
      ? targetId
      : targetId === 'custom-dictionary'
        ? 'section-words'
        : targetId === 'online-retry'
          ? 'section-privacy'
          : undefined;
    if (sectionLinkId) {
      for (const node of root.querySelectorAll('.options-nav-link')) {
        node.classList.toggle('is-active', node.getAttribute('data-qianci-section-link') === sectionLinkId);
      }
    }
  };

  const render = (): void => {
    renderOptions(
      root,
      {
        level: profile.level,
        underlineTone: profile.underlineTone,
        lookupTrigger: profile.lookupTrigger,
        manualShortcut: profile.manualShortcut,
        offlineDictionaryTier: profile.offlineDictionaryTier,
        annotationDensity: profile.annotationDensity,
        onboardingDismissedAt: profile.onboardingDismissedAt,
        feedbackSettings: profile.feedbackSettings,
        vocab,
        knownWords: knownWords(),
        weakHiddenCount: weakHiddenCount(),
        skippedWords: skippedWords(),
        alwaysAnnotatedWords: alwaysAnnotatedWords(),
        onlineRetryItems: Object.values(onlineLookupQueue),
        onlineCacheCount: countOnlineDictionaryEntries(customDictionary),
        retryQueueCount: Object.keys(onlineLookupQueue).length,
        sitePolicyCount: Object.keys(sitePolicies).length,
        searchQuery,
        onlineLookupEnabled: isOnlineLookupEnabled(profile),
        customEntries: listUserCustomEntries(customDictionary),
        customDraftWord,
        customDraftTranslation,
        customEditingWord,
        customDictionaryMessage
      },
      {
        onLevelChange: async (level) => {
          profile = { ...profile, level };
          await saveProfile(store, profile);
          render();
        },
        onToneChange: async (tone) => {
          profile = { ...profile, underlineTone: tone };
          await saveProfile(store, profile);
          render();
        },
        onLookupTriggerChange: async (trigger) => {
          profile = { ...profile, lookupTrigger: trigger };
          await saveProfile(store, profile);
          render();
        },
        onManualShortcutChange: async (shortcut) => {
          profile = { ...profile, manualShortcut: shortcut };
          await saveProfile(store, profile);
          render();
        },
        onOfflineDictionaryTierChange: async (tier) => {
          profile = { ...profile, offlineDictionaryTier: normalizeOfflineDictionaryTier(tier) };
          await saveProfile(store, profile);
          render();
        },
        onAnnotationDensityChange: async (density) => {
          profile = { ...profile, annotationDensity: normalizeAnnotationDensity(density) };
          await saveProfile(store, profile);
          render();
        },
        onDismissOnboarding: async () => {
          profile = { ...profile, onboardingDismissedAt: Date.now() };
          await saveProfile(store, profile);
          render();
        },
        onReopenOnboarding: async () => {
          const { onboardingDismissedAt: _dismissedAt, ...nextProfile } = profile;
          profile = nextProfile;
          await saveProfile(store, profile);
          render();
        },
        onApplyOnboardingPreset: async (preset) => {
          profile = {
            ...profile,
            annotationDensity: normalizeAnnotationDensity(preset.annotationDensity),
            lookupTrigger: preset.lookupTrigger,
            onboardingDismissedAt: Date.now()
          };
          await saveProfile(store, profile);
          render();
        },
        onSuppressionModeChange: async (mode) => {
          profile = {
            ...profile,
            feedbackSettings: SUPPRESSION_MODE_SETTINGS[mode]
          };
          await saveProfile(store, profile);
          render();
        },
        onResetSkipFeedback: async () => {
          const shouldReset = window.confirm('重置后，潜词会重新观察被你跳过的词。熟词和生词不会被删除。');
          if (!shouldReset) {
            return;
          }

          profile = resetAllSkipFeedback(profile);
          await saveProfile(store, profile);
          render();
        },
        onRestoreSkipFeedback: async (word) => {
          profile = resetSkipFeedback(profile, word);
          await saveProfile(store, profile);
          render();
        },
        onAlwaysAnnotate: async (word) => {
          profile = markWordAlwaysAnnotate(profile, word, Date.now());
          await saveProfile(store, profile);
          render();
        },
        onUnpinAlwaysAnnotate: async (word) => {
          profile = unmarkWordAlwaysAnnotate(profile, word);
          await saveProfile(store, profile);
          render();
        },
        onClearOnlineRetryQueue: async () => {
          const shouldClear = window.confirm(
            '清空后，潜词不会再自动重试这些联网查词。已保存的生词不会被删除。'
          );
          if (!shouldClear) {
            return;
          }

          onlineLookupQueue = {};
          await saveOnlineLookupQueue(store, onlineLookupQueue);
          render();
        },
        onClearOnlineCache: async () => {
          const shouldClear = window.confirm(
            '清空后，已联网补查过的词会回到本地词库缺词状态。生词记录不会被删除。'
          );
          if (!shouldClear) {
            return;
          }

          customDictionary = removeOnlineDictionaryEntries(customDictionary);
          await saveCustomDictionary(store, customDictionary);
          render();
        },
        onClearSitePolicies: async () => {
          const shouldClear = window.confirm(
            '清空后，所有网站会恢复默认自动模式。生词和学习设置不会被删除。'
          );
          if (!shouldClear) {
            return;
          }

          sitePolicies = {};
          await saveSitePolicies(store, sitePolicies);
          render();
        },
        onOnlineLookupEnabledChange: async (enabled) => {
          profile = { ...profile, onlineLookupEnabled: enabled };
          await saveProfile(store, profile);
          render();
        },
        onSearchChange: async (query) => {
          searchQuery = query;
          render();
        },
        onCustomDraftWordChange: async (word) => {
          customDraftWord = word;
        },
        onCustomDraftTranslationChange: async (translation) => {
          customDraftTranslation = translation;
        },
        onSaveCustomEntry: async (word, translation) => {
          const normalized = normalizeCustomEntryInput(word, translation);
          if ('error' in normalized) {
            customDictionaryMessage = normalized.error;
            render();
            return;
          }

          customDictionary = upsertCustomDictionary(customDictionary, {
            word: normalized.word,
            phonetic: customDictionary[normalized.word]?.phonetic ?? '',
            translation: normalized.translation,
            rank: customDictionary[normalized.word]?.rank ?? 0,
            source: 'custom'
          });
          await saveCustomDictionary(store, customDictionary);
          customDraftWord = '';
          customDraftTranslation = '';
          customEditingWord = undefined;
          customDictionaryMessage = `已保存 ${normalized.word} 的自定义释义`;
          render();
        },
        onDeleteCustomEntry: async (word) => {
          customDictionary = removeCustomDictionaryEntry(customDictionary, word);
          await saveCustomDictionary(store, customDictionary);
          if (customEditingWord === word) {
            customDraftWord = '';
            customDraftTranslation = '';
            customEditingWord = undefined;
          }
          customDictionaryMessage = `已删除 ${word}`;
          render();
        },
        onStartEditCustomEntry: async (word) => {
          const entry = customDictionary[word];
          if (!entry || entry.source !== 'custom') {
            return;
          }
          customEditingWord = word;
          customDraftWord = entry.word;
          customDraftTranslation = entry.translation;
          customDictionaryMessage = `正在编辑 ${word}`;
          render();
        },
        onRemoveVocab: async (word) => {
          vocab = removeVocabItem(vocab, word);
          render();
          await saveVocab(store, vocab);
        },
        onForgetKnown: async (word) => {
          const state = profile.words[word];
          if (!state) {
            return;
          }

          profile = {
            ...profile,
            words: {
              ...profile.words,
              [word]: {
                ...state,
                familiarity: 0,
                isKnown: false,
                isUnknown: false
              }
            }
          };
          render();
          await saveProfile(store, profile);
        },
        onMarkVocabKnown: async (word) => {
          if (!vocab.some((item) => item.word === word)) {
            return;
          }

          const nextProfile = applyKnownFeedback(profile, word, Date.now());
          const nextVocab = removeVocabItem(vocab, word);
          await saveProfile(store, nextProfile);
          await saveVocab(store, nextVocab);
          profile = nextProfile;
          vocab = nextVocab;
          render();
        },
        onExport: async (csv) => {
          downloadCsv(csv);
        },
        onExportJson: async (json) => {
          downloadJson(json);
        },
        onExportAnki: async (csv) => {
          downloadCsv(csv);
        },
        onExportFullBackup: async () => {
          const backup = buildFullBackup({
            profile,
            vocab,
            customDictionary,
            sitePolicies
          });
          downloadTextFile(
            JSON.stringify(backup, null, 2),
            'application/json;charset=utf-8',
            'json',
            'qianci-backup'
          );
        },
        onImportFullBackup: async (raw, conflict) => {
          const parsed = parseBackupJson(raw);
          if (!parsed.ok || !parsed.backup) {
            window.alert(parsed.message);
            return;
          }

          const shouldImport = window.confirm(
            `将导入备份（${parsed.backup.exportedAt}）。冲突策略：${
              conflict === 'merge' ? '合并' : conflict === 'overwrite' ? '覆盖' : '跳过'
            }。继续？`
          );
          if (!shouldImport) {
            return;
          }

          if (parsed.backup.profile) {
            profile = parsed.backup.profile;
            await saveProfile(store, profile);
          }
          if (parsed.backup.vocab) {
            vocab =
              conflict === 'overwrite'
                ? parsed.backup.vocab
                : mergeVocabLists(vocab, parsed.backup.vocab, conflict);
            await saveVocab(store, vocab);
          }
          if (parsed.backup.customDictionary) {
            if (conflict === 'overwrite') {
              customDictionary = parsed.backup.customDictionary;
            } else {
              customDictionary = { ...customDictionary, ...parsed.backup.customDictionary };
              // skip：不覆盖已有自定义词
              if (conflict === 'skip') {
                const previous = await loadCustomDictionary(store);
                customDictionary = { ...parsed.backup.customDictionary, ...previous };
              }
            }
            await saveCustomDictionary(store, customDictionary);
          }
          if (parsed.backup.sitePolicies) {
            sitePolicies =
              conflict === 'overwrite'
                ? parsed.backup.sitePolicies
                : { ...sitePolicies, ...parsed.backup.sitePolicies };
            await saveSitePolicies(store, sitePolicies);
          }

          customDictionaryMessage = '备份导入完成';
          render();
        }
      }
    );
    applyHashTarget();
  };

  render();
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
      applyHashTarget();
    });
  }
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void mountOptionsApp(app);
}
