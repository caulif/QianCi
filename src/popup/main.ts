import './styles.css';
import {
  applyKnownFeedback,
  applyLookupFeedback,
  createProfile,
  DEFAULT_ANNOTATION_DENSITY,
  isOnlineLookupEnabled,
  MANUAL_SHORTCUTS,
  MAX_ANNOTATION_DENSITY,
  MIN_ANNOTATION_DENSITY,
  normalizeAnnotationDensity
} from '../core/profile';
import type { DictionaryEntry } from '../core/dictionaryEntry';
import { dictionarySourceLabel } from '../core/dictionarySource';
import {
  ONLINE_LOOKUP_MESSAGE_TYPE,
  PAGE_DIAGNOSTICS_MESSAGE_TYPE,
  RESCAN_PAGE_MESSAGE_TYPE,
  type OnlineLookupResult,
  type PageDiagnostics
} from '../core/messages';
import { getSiteModeForUrl, normalizeSiteKey, upsertSitePolicy } from '../core/sitePolicy';
import type { ManualShortcut, SiteMode } from '../core/types';
import { createChromeStorageAdapter, createMemoryStore, type KeyValueStore } from '../storage/browserAdapter';
import {
  loadCustomDictionary,
  upsertOnlineDictionaryEntry,
  saveCustomDictionary
} from '../storage/customDictionaryStore';
import { loadOnlineLookupQueue } from '../storage/onlineLookupQueueStore';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { loadSitePolicies, saveSitePolicies } from '../storage/sitePolicyStore';
import { loadVocab, removeVocabItem, saveVocab, upsertVocabItem } from '../storage/vocabStore';

export interface PopupLookupResult {
  status: 'idle' | 'loading' | 'found' | 'missing' | 'error' | 'known';
  query: string;
  entry?: DictionaryEntry;
  message?: string;
}

export interface PopupState {
  siteKey?: string;
  mode: SiteMode;
  excludeSelectorsText?: string;
  allowSameOriginFrames?: boolean;
  retryQueueCount?: number;
  extensionVersion?: string;
  diagnostics?: PageDiagnostics;
  annotationDensity?: number;
  isRescanning?: boolean;
  isAdjustingDensity?: boolean;
  canUndoDensityChange?: boolean;
  diagnosticsStatusMessage?: string;
  lookupQuery?: string;
  lookupResult?: PopupLookupResult;
  isLookingUp?: boolean;
  /** 手动查词快捷键展示文案，如 Alt */
  manualShortcutLabel?: string;
  /** 是否展开更多站点选项 */
  siteAdvancedOpen?: boolean;
  /** 是否展开诊断详情 */
  diagnosticsDetailsOpen?: boolean;
  /** 因弱反馈被隐藏的词数量（可解释性） */
  weakHiddenCount?: number;
  /** 首次使用：尚未关闭引导 */
  showFirstRunHint?: boolean;
}

interface PopupHandlers {
  onModeChange?: (mode: SiteMode) => void | Promise<void>;
  onExcludeSelectorsChange?: (text: string) => void | Promise<void>;
  onAllowSameOriginFramesChange?: (enabled: boolean) => void | Promise<void>;
  onOpenOptions?: (section?: string) => void | Promise<void>;
  onRescanPage?: () => void | Promise<void>;
  onIncreaseAnnotationDensity?: () => void | Promise<void>;
  onReduceAnnotationDensity?: () => void | Promise<void>;
  onResetAnnotationDensity?: () => void | Promise<void>;
  onUndoAnnotationDensity?: () => void | Promise<void>;
  onCopyDiagnostics?: (report: string) => void | Promise<void>;
  onLookupQueryChange?: (query: string) => void | Promise<void>;
  onLookupSubmit?: (query: string) => void | Promise<void>;
  onMarkLookupKnown?: (word: string) => void | Promise<void>;
  onToggleSiteAdvanced?: () => void | Promise<void>;
  onToggleDiagnosticsDetails?: () => void | Promise<void>;
  /** 用户任务：少标一点 */
  onLessAnnotate?: () => void | Promise<void>;
  /** 用户任务：更稳一点 */
  onMoreStable?: () => void | Promise<void>;
  /** 用户任务：暂停本站 */
  onPauseSite?: () => void | Promise<void>;
  /** 用户任务：恢复自动标注 */
  onRestoreAuto?: () => void | Promise<void>;
  /** 打开设置中的标注策略（弱反馈恢复） */
  onOpenStrategy?: () => void | Promise<void>;
}

export interface PopupDependencies {
  currentUrl(): Promise<string | undefined>;
  store: KeyValueStore;
  openOptions(section?: string): void | Promise<void>;
  getPageDiagnostics?(): Promise<PageDiagnostics | undefined>;
  rescanPage?(): Promise<void>;
  copyText?(text: string): Promise<void>;
  extensionVersion?(): Promise<string>;
  lookupWord?(word: string): Promise<OnlineLookupResult>;
}

/**
 * 构建设置页深链 hash（不含 #）。
 */
export function optionsSectionHash(section: string): string {
  const cleaned = section.replace(/^#/, '').trim();
  return cleaned;
}

const SITE_MODES: Array<{ mode: SiteMode; label: string; description: string }> = [
  { mode: 'auto', label: '自动标注', description: '正常扫描并标出生词' },
  { mode: 'low-density', label: '少标模式', description: '自动标注，但更少提醒' },
  { mode: 'safe', label: '更稳模式', description: '跳过更多噪声区，保留手动查词' },
  { mode: 'manual-only', label: '仅手动查词', description: '不自动划线，保留划词和右键查词' },
  { mode: 'paused', label: '暂停本站', description: '当前站点不标注，也不响应手动查词' }
];
const QUICK_DENSITY_STEP = 0.1;

/**
 * 统计因弱反馈达到隐藏阈值的词数。
 */
export function countWeakHiddenWords(profile: {
  words: Record<string, { isKnown?: boolean; familiarity?: number }>;
  feedbackSettings: { skipLimit: number };
}): number {
  return Object.values(profile.words).filter(
    (state) => !state.isKnown && (state.familiarity ?? 0) >= profile.feedbackSettings.skipLimit
  ).length;
}

/**
 * 站点模式的用户可读标签。
 */
export function siteModeLabel(mode: SiteMode): string {
  return SITE_MODES.find((item) => item.mode === mode)?.label ?? '自动标注';
}

export type SiteTaskAction =
  | { kind: 'mode'; mode: SiteMode }
  | { kind: 'reduce-density' }
  | { kind: 'noop'; reason: string };

/**
 * 「少标一点」：auto→low-density；low-density→再降全局密度。
 * paused / manual-only / safe 不静默改模式（safe 回 low-density 会标更多，禁止）。
 */
export function resolveLessAnnotateAction(mode: SiteMode): SiteTaskAction {
  if (mode === 'paused') {
    return { kind: 'noop', reason: '本站已暂停。点“恢复自动标注”后再调节。' };
  }
  if (mode === 'manual-only') {
    return { kind: 'noop', reason: '已是仅手动查词，自动标注已关闭。' };
  }
  if (mode === 'safe') {
    return {
      kind: 'noop',
      reason: '已是更稳模式。可再点“更稳一点”切到仅手动，或暂停本站。'
    };
  }
  if (mode === 'low-density') {
    return { kind: 'reduce-density' };
  }
  return { kind: 'mode', mode: 'low-density' };
}

/**
 * 「更稳一点」：auto/low-density→safe；safe→manual-only；终点与暂停给 noop。
 */
export function resolveMoreStableAction(mode: SiteMode): SiteTaskAction {
  if (mode === 'paused') {
    return { kind: 'noop', reason: '本站已暂停。点“恢复自动标注”后再调节。' };
  }
  if (mode === 'manual-only') {
    return { kind: 'noop', reason: '已是最稳：仅手动查词。需要完全静默可点“暂停”。' };
  }
  if (mode === 'safe') {
    return { kind: 'mode', mode: 'manual-only' };
  }
  return { kind: 'mode', mode: 'safe' };
}

/**
 * 全局密度下调后的状态文案（明确作用域为所有网站）。
 */
export function globalDensityReduceStatusText(nextDensity: number): string {
  return `已降低全局标注密度至 ${Math.round(nextDensity * 100)}%（所有网站）`;
}

/**
 * 全局密度已到下限时的提示。
 */
export function globalDensityFloorStatusText(): string {
  return '全局标注密度已是最低。可再点“更稳一点”或“暂停”。';
}

/**
 * 生成可复制的问题排查报告。
 *
 * 报告只包含域名、模式、计数和警告，不包含页面 URL、标题或正文。
 *
 * @param state 当前 popup 状态。
 * @returns 可直接复制到 issue 或聊天反馈中的文本。
 */
export function buildDiagnosticReport(state: PopupState): string {
  const diagnostics = state.diagnostics;
  const warningText = diagnostics?.warnings.length ? diagnostics.warnings.join(', ') : '无';
  const lines = [
    '潜词页面诊断',
    'schemaVersion：qianci-page-diagnostics-v1',
    `生成时间：${new Date().toISOString()}`,
    `扩展版本：${state.extensionVersion ?? 'unknown'}`,
    `站点：${state.siteKey ?? '无法识别'}`,
    `模式：${state.mode}`,
    `页面模式：${diagnostics?.siteMode ?? '未知'}`,
    `已标注：${diagnostics?.annotatedWords ?? 0}`,
    `已检查文本段：${diagnostics?.scannedTextNodes ?? 0}`,
    `扫描状态：${diagnostics ? diagnosticStatusText(diagnostics) : '不可读'}`,
    `最近扫描耗时：${diagnostics?.lastScanDurationMs ?? 0}ms`,
    `重试队列：${state.retryQueueCount ?? 0}`,
    `警告：${warningText}`,
    '页面正文：不包含'
  ];

  return lines.join('\n');
}

/**
 * 生成可直接粘贴到 issue 或聊天反馈中的脱敏问题模板。
 *
 * 模板包含用户需要补充的问题字段和安全诊断信息，不包含页面正文、完整 URL 或选中文本。
 *
 * @param state 当前 popup 状态。
 * @returns 可复制的反馈模板文本。
 */
export function buildFeedbackTemplate(state: PopupState): string {
  return [
    '潜词问题反馈',
    '',
    '问题现象：',
    '请用一句话描述你看到的问题，例如：这个页面没有自动标注，或标注影响了输入。',
    '',
    '期望结果：',
    '请描述你希望潜词怎么表现，例如：能标注正文，但不要处理代码块或输入框。',
    '',
    '实际结果：',
    '请描述实际发生了什么，例如：没有标注、标注过多、查词失败或页面变慢。',
    '',
    '隐私提醒：',
    '请不要粘贴页面正文、账号、token 或其它隐私内容。',
    '',
    '诊断信息：',
    buildDiagnosticReport(state)
  ].join('\n');
}

function diagnosticStatusText(diagnostics: PageDiagnostics): string {
  if (diagnostics.pendingScan) {
    return '正在扫描';
  }

  return '当前空闲';
}

/**
 * 生成当前站点模式切换后的确认文案。
 *
 * @param mode 新的站点模式。
 * @returns 面向 popup 状态栏展示的短提示。
 */
function siteModeStatusText(mode: SiteMode): string {
  if (mode === 'auto') {
    return '已恢复自动标注，并重新扫描当前页。';
  }

  if (mode === 'low-density') {
    return '已切到少标模式，会减少自动标注。';
  }

  if (mode === 'safe') {
    return '已切到更稳模式，会跳过更多噪声区域。';
  }

  if (mode === 'manual-only') {
    return '已切到仅手动查词，当前站点不会自动划线。';
  }

  return '已暂停当前站点，潜词不会处理这个站点。';
}

function diagnosticWarningTexts(diagnostics: PageDiagnostics): string[] {
  const warningTexts: string[] = [];
  if (diagnostics.warnings.includes('paused')) {
    warningTexts.push('本站已暂停。点“恢复自动标注”可重新标注。');
  }

  if (diagnostics.warnings.includes('manual-only')) {
    warningTexts.push('仅手动查词中。可用选词查词，或点“恢复自动标注”。');
  }

  if (diagnostics.warnings.includes('dynamic-page')) {
    warningTexts.push('页面变化较频繁，扫描会放慢。');
  }

  if (diagnostics.warnings.includes('editor-detected')) {
    warningTexts.push('检测到编辑区，建议“更稳一点”或仅手动。');
  }

  if (diagnostics.warnings.includes('form-heavy')) {
    warningTexts.push('表单较多，自动标注更保守。');
  }

  if (diagnostics.warnings.includes('code-heavy')) {
    warningTexts.push('代码较多，漏词可用选词查词。');
  }

  if (diagnostics.warnings.includes('search-page')) {
    warningTexts.push('像是搜索页，干扰时可点“少标一点”。');
  }

  if (diagnostics.warnings.includes('low-density')) {
    warningTexts.push('少标模式：只标更可能不认识的词。');
  }

  if (diagnostics.warnings.includes('safe')) {
    warningTexts.push('更稳模式：表格、表单、侧栏等默认不标。');
  }

  if (diagnostics.warnings.includes('frame-context')) {
    warningTexts.push('当前在同源嵌入页中运行。');
  }

  return warningTexts;
}

/**
 * 零标注时的一句原因（压短，动作交给主按钮）。
 */
export function diagnosticEmptyAnnotationText(
  diagnostics: PageDiagnostics,
  shortcutLabel = 'Alt'
): string {
  if (
    diagnostics.pendingScan ||
    diagnostics.annotatedWords > 0 ||
    diagnostics.warnings.length > 0
  ) {
    return '';
  }

  if (diagnostics.scannedTextNodes === 0) {
    return `暂未找到可扫描的英文正文。可点“重新扫描”，或 ${shortcutLabel}+选词 / 右键 / 上方快查。`;
  }

  return `暂无需要提醒的词。可点“多提醒一点”，或 ${shortcutLabel}+选词 / 右键 / 上方快查补漏。`;
}

/**
 * 状态卡主提示：优先状态消息，否则一句诊断原因。
 */
export function popupStatusHint(state: PopupState): string {
  if (state.diagnosticsStatusMessage) {
    return state.diagnosticsStatusMessage;
  }
  if (!state.diagnostics) {
    return (
      '当前页暂不可读。浏览器系统页、扩展商店或受限制页面无法注入内容脚本。' +
      '可换到普通 http(s) 网页，或点“重新扫描”。'
    );
  }
  if (state.weakHiddenCount && state.weakHiddenCount > 0 && !state.diagnostics.pendingScan) {
    const warnings = diagnosticWarningTexts(state.diagnostics);
    if (!warnings[0] && state.diagnostics.annotatedWords === 0) {
      return `有 ${state.weakHiddenCount} 个词因路过未点开被自动收起。可在设置「标注策略」恢复。`;
    }
  }
  const warnings = diagnosticWarningTexts(state.diagnostics);
  if (warnings[0]) {
    return warnings[0];
  }
  if (state.weakHiddenCount && state.weakHiddenCount > 0) {
    return `有 ${state.weakHiddenCount} 个词因路过未点开被自动收起。可在设置「标注策略」恢复。`;
  }
  return diagnosticEmptyAnnotationText(state.diagnostics, state.manualShortcutLabel ?? 'Alt');
}

function hasSafeManualModeSuggestion(diagnostics: PageDiagnostics): boolean {
  return (
    diagnostics.warnings.includes('editor-detected') ||
    diagnostics.warnings.includes('form-heavy') ||
    diagnostics.warnings.includes('code-heavy')
  );
}

/**
 * 全局密度微调：仅在 auto 且 0 标注、可上调时显示（与「少标一点」不重叠）。
 */
function shouldShowDensityIncrease(state: PopupState): boolean {
  if (
    state.mode !== 'auto' ||
    !state.diagnostics ||
    state.isRescanning ||
    state.diagnostics.siteMode !== 'auto' ||
    state.diagnostics.pendingScan ||
    state.diagnostics.annotatedWords > 0 ||
    state.diagnostics.scannedTextNodes === 0 ||
    state.diagnostics.warnings.length > 0
  ) {
    return false;
  }

  const currentDensity = normalizeAnnotationDensity(state.annotationDensity ?? DEFAULT_ANNOTATION_DENSITY);
  return currentDensity < MAX_ANNOTATION_DENSITY;
}

/**
 * 全局密度恢复默认：仅当已偏离默认且与三主按钮不重复时显示。
 */
function shouldShowDensityReset(state: PopupState): boolean {
  if (
    state.mode !== 'auto' ||
    !state.diagnostics ||
    state.isRescanning ||
    state.diagnostics.siteMode !== 'auto' ||
    state.diagnostics.pendingScan
  ) {
    return false;
  }

  const currentDensity = normalizeAnnotationDensity(state.annotationDensity ?? DEFAULT_ANNOTATION_DENSITY);
  return currentDensity !== DEFAULT_ANNOTATION_DENSITY;
}

/**
 * 创建页面诊断复制按钮。
 *
 * @param state 当前 popup 状态，用于构建安全诊断报告。
 * @param handlers popup 事件处理器。
 * @returns 可直接插入诊断面板的按钮。
 */
function createCopyDiagnosticsButton(state: PopupState, handlers: PopupHandlers): HTMLButtonElement {
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'diagnostics-button';
  copyButton.dataset.qianciCopyDiagnostics = 'true';
  copyButton.setAttribute('aria-label', '复制页面诊断信息');
  copyButton.textContent = '复制诊断信息';
  copyButton.addEventListener('click', () => {
    void handlers.onCopyDiagnostics?.(buildDiagnosticReport(state));
  });
  return copyButton;
}

/**
 * 创建页面问题反馈模板复制按钮。
 *
 * @param state 当前 popup 状态，用于构建脱敏反馈模板。
 * @param handlers popup 事件处理器。
 * @returns 可直接插入诊断面板的按钮。
 */
function createCopyFeedbackTemplateButton(state: PopupState, handlers: PopupHandlers): HTMLButtonElement {
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'diagnostics-button';
  copyButton.dataset.qianciCopyFeedbackTemplate = 'true';
  copyButton.setAttribute('aria-label', '复制页面问题反馈模板');
  copyButton.textContent = '复制反馈模板';
  copyButton.addEventListener('click', () => {
    void handlers.onCopyDiagnostics?.(buildFeedbackTemplate(state));
  });
  return copyButton;
}

/**
 * 规范化弹窗快速查词输入，只保留单个英文单词形态。
 *
 * @param raw 用户输入。
 * @returns 小写英文词；无法识别时返回空串。
 */
export function normalizePopupLookupQuery(raw: string): string {
  const match = raw.trim().toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/);
  return match?.[0]?.replace(/’/g, "'") ?? '';
}

/**
 * 渲染弹窗顶部的快速查词面板。
 *
 * @param state 当前 popup 状态。
 * @param handlers 查词相关回调。
 * @returns 查词面板节点。
 */
function renderLookupPanel(state: PopupState, handlers: PopupHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'lookup-panel';
  panel.setAttribute('aria-busy', state.isLookingUp ? 'true' : 'false');

  const title = document.createElement('div');
  title.className = 'lookup-title';
  title.textContent = '快速查词';
  panel.append(title);

  const form = document.createElement('form');
  form.className = 'lookup-form';

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'lookup-input';
  input.dataset.qianciLookupInput = 'true';
  input.placeholder = '输入英文单词';
  input.value = state.lookupQuery ?? '';
  input.setAttribute('aria-label', '搜索或查词');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    void handlers.onLookupQueryChange?.(input.value);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // 以输入框当前值提交，避免依赖尚未 re-render 的 state 快照。
    void handlers.onLookupSubmit?.(input.value);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'lookup-submit';
  submit.dataset.qianciLookupSubmit = 'true';
  submit.disabled = Boolean(state.isLookingUp);
  submit.textContent = state.isLookingUp ? '查询中…' : '查询';

  form.append(input, submit);
  panel.append(form);

  const result = state.lookupResult;
  if (result && result.status !== 'idle') {
    const resultBox = document.createElement('div');
    resultBox.className = 'lookup-result';
    resultBox.dataset.qianciLookupResult = result.status;
    resultBox.setAttribute('role', 'status');
    resultBox.setAttribute('aria-live', 'polite');

    if (result.status === 'loading') {
      resultBox.textContent = `正在查询 ${result.query}…`;
    } else if (result.status === 'found' && result.entry) {
      const wordLine = document.createElement('div');
      wordLine.className = 'lookup-result-word';
      wordLine.textContent = result.entry.word;
      resultBox.append(wordLine);

      if (result.entry.phonetic) {
        const phonetic = document.createElement('div');
        phonetic.className = 'lookup-result-meta';
        phonetic.textContent = result.entry.phonetic;
        resultBox.append(phonetic);
      }

      const translation = document.createElement('div');
      translation.className = 'lookup-result-translation';
      translation.textContent = result.entry.translation;
      resultBox.append(translation);

      if (result.message) {
        const meta = document.createElement('div');
        meta.className = 'lookup-result-meta';
        meta.textContent = result.message;
        resultBox.append(meta);
      }

      const knownButton = document.createElement('button');
      knownButton.type = 'button';
      knownButton.className = 'lookup-known-button';
      knownButton.dataset.qianciLookupKnown = result.entry.word;
      knownButton.textContent = '标为认识';
      knownButton.setAttribute('aria-label', `将 ${result.entry.word} 标为认识`);
      knownButton.addEventListener('click', () => {
        void handlers.onMarkLookupKnown?.(result.entry!.word);
      });
      resultBox.append(knownButton);

      const editLink = document.createElement('button');
      editLink.type = 'button';
      editLink.className = 'lookup-known-button';
      editLink.dataset.qianciLookupEdit = result.entry.word;
      editLink.textContent = '改释义…';
      editLink.addEventListener('click', () => {
        void handlers.onOpenOptions?.('custom-dictionary');
      });
      resultBox.append(editLink);
    } else if (result.status === 'known') {
      resultBox.textContent = result.message ?? `已将 ${result.query} 标为认识`;
    } else {
      resultBox.textContent = result.message ?? `未找到 ${result.query}`;
    }

    panel.append(resultBox);
  }

  return panel;
}

/**
 * 本页工具区：重扫、反馈，以及折叠的诊断详情与密度微调。
 */
function renderPageToolsPanel(state: PopupState, handlers: PopupHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'diagnostics-panel';
  const isDiagnosticsBusy = Boolean(state.isRescanning || state.isAdjustingDensity);
  panel.setAttribute('aria-busy', isDiagnosticsBusy ? 'true' : 'false');

  const title = document.createElement('div');
  title.className = 'diagnostics-title';
  title.textContent = '本页工具';
  panel.append(title);

  const toolsRow = document.createElement('div');
  toolsRow.className = 'tools-row';

  const rescanButton = document.createElement('button');
  rescanButton.type = 'button';
  rescanButton.className = 'diagnostics-button diagnostics-button-primary';
  rescanButton.dataset.qianciRescanPage = 'true';
  rescanButton.disabled = isDiagnosticsBusy;
  rescanButton.setAttribute('aria-busy', isDiagnosticsBusy ? 'true' : 'false');
  rescanButton.setAttribute('aria-label', isDiagnosticsBusy ? '当前页面诊断正在更新' : '重新扫描本页');
  rescanButton.textContent = state.isRescanning ? '扫描中…' : '重新扫描';
  rescanButton.addEventListener('click', () => {
    void handlers.onRescanPage?.();
  });
  toolsRow.append(rescanButton);

  const feedbackButton = createCopyFeedbackTemplateButton(state, handlers);
  feedbackButton.className = 'diagnostics-button';
  feedbackButton.textContent = '复制反馈';
  toolsRow.append(feedbackButton);
  panel.append(toolsRow);

  if (shouldShowDensityIncrease(state)) {
    const increaseDensityButton = document.createElement('button');
    increaseDensityButton.type = 'button';
    increaseDensityButton.className = 'diagnostics-button';
    increaseDensityButton.dataset.qianciIncreaseDensity = 'true';
    increaseDensityButton.disabled = Boolean(state.isAdjustingDensity);
    increaseDensityButton.textContent = '多提醒一点（全局密度）';
    increaseDensityButton.addEventListener('click', () => {
      void handlers.onIncreaseAnnotationDensity?.();
    });
    panel.append(increaseDensityButton);
  }

  if (shouldShowDensityReset(state)) {
    const resetDensityButton = document.createElement('button');
    resetDensityButton.type = 'button';
    resetDensityButton.className = 'diagnostics-button';
    resetDensityButton.dataset.qianciResetDensity = 'true';
    resetDensityButton.disabled = Boolean(state.isAdjustingDensity);
    resetDensityButton.textContent = '恢复默认全局密度';
    resetDensityButton.addEventListener('click', () => {
      void handlers.onResetAnnotationDensity?.();
    });
    panel.append(resetDensityButton);
  }

  if (state.canUndoDensityChange && !state.isAdjustingDensity && !state.isRescanning) {
    const undoDensityButton = document.createElement('button');
    undoDensityButton.type = 'button';
    undoDensityButton.className = 'diagnostics-button';
    undoDensityButton.dataset.qianciUndoDensity = 'true';
    undoDensityButton.textContent = '撤销全局密度调整';
    undoDensityButton.addEventListener('click', () => {
      void handlers.onUndoAnnotationDensity?.();
    });
    panel.append(undoDensityButton);
  }

  if (state.mode === 'auto' && state.diagnostics && hasSafeManualModeSuggestion(state.diagnostics)) {
    const safeModeButton = document.createElement('button');
    safeModeButton.type = 'button';
    safeModeButton.className = 'diagnostics-button';
    safeModeButton.dataset.qianciSafeManualMode = 'true';
    safeModeButton.textContent = '切到仅手动查词';
    safeModeButton.addEventListener('click', () => {
      void handlers.onModeChange?.('manual-only');
    });
    panel.append(safeModeButton);
  }

  const detailsToggle = document.createElement('button');
  detailsToggle.type = 'button';
  detailsToggle.className = 'fold-toggle';
  detailsToggle.dataset.qianciToggleDiagnostics = 'true';
  detailsToggle.setAttribute('aria-expanded', String(Boolean(state.diagnosticsDetailsOpen)));
  detailsToggle.textContent = state.diagnosticsDetailsOpen ? '▾ 收起诊断详情' : '▸ 诊断详情';
  detailsToggle.addEventListener('click', () => {
    void handlers.onToggleDiagnosticsDetails?.();
  });
  panel.append(detailsToggle);

  if (state.diagnosticsDetailsOpen) {
    const details = document.createElement('div');
    details.className = 'fold-body';
    details.dataset.qianciDiagnosticsDetails = 'true';

    if (state.diagnostics) {
      const summary = document.createElement('p');
      summary.className = 'diagnostics-copy';
      summary.textContent = `已标注 ${state.diagnostics.annotatedWords} 个词 · 已检查 ${state.diagnostics.scannedTextNodes} 段 · ${diagnosticStatusText(state.diagnostics)}`;
      details.append(summary);

      for (const warningText of diagnosticWarningTexts(state.diagnostics)) {
        const warning = document.createElement('p');
        warning.className = 'diagnostics-copy diagnostics-warning';
        warning.textContent = warningText;
        details.append(warning);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'diagnostics-copy';
      empty.textContent = '当前页诊断不可读。';
      details.append(empty);
    }

    details.append(createCopyDiagnosticsButton(state, handlers));
    panel.append(details);
  }

  return panel;
}

function renderStatusCard(state: PopupState, handlers: PopupHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'status-card';
  card.dataset.qianciStatusCard = 'true';

  const title = document.createElement('div');
  title.className = 'status-card-title';
  title.textContent = state.siteKey ? `潜词 · ${state.siteKey}` : '潜词';
  card.append(title);

  const summary = document.createElement('p');
  summary.className = 'status-card-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  if (state.isRescanning) {
    summary.textContent = '正在重新扫描本页…';
  } else if (state.isAdjustingDensity) {
    summary.textContent = '正在调整标注密度…';
  } else if (state.diagnostics) {
    summary.textContent = `已检查 ${state.diagnostics.scannedTextNodes} 段 · 标注 ${state.diagnostics.annotatedWords} 词 · ${diagnosticStatusText(state.diagnostics)}`;
  } else {
    summary.textContent = '当前页暂不可读';
  }
  card.append(summary);

  const hint = popupStatusHint(state);
  if (hint && !state.isRescanning && !state.isAdjustingDensity) {
    const hintLine = document.createElement('p');
    hintLine.className = 'status-card-hint';
    hintLine.setAttribute('role', 'status');
    hintLine.setAttribute('aria-live', 'polite');
    hintLine.textContent = hint;
    card.append(hintLine);
  }

  const shortcut = state.manualShortcutLabel ?? 'Alt';
  const tip = document.createElement('p');
  tip.className = 'status-card-tip';
  tip.textContent = `漏词？${shortcut}+选中单词，或下方快速查词`;
  tip.dataset.qianciManualTip = 'true';
  card.append(tip);

  if (state.showFirstRunHint) {
    const firstRun = document.createElement('button');
    firstRun.type = 'button';
    firstRun.className = 'diagnostics-button';
    firstRun.dataset.qianciFirstRunHint = 'true';
    firstRun.textContent = '第一次用？打开阅读引导';
    firstRun.addEventListener('click', () => {
      void handlers.onOpenOptions?.('section-reading');
    });
    card.append(firstRun);
  }

  if (state.weakHiddenCount && state.weakHiddenCount > 0) {
    const weakLink = document.createElement('button');
    weakLink.type = 'button';
    weakLink.className = 'diagnostics-button';
    weakLink.dataset.qianciOpenStrategy = 'true';
    weakLink.textContent = `查看被收起的词（${state.weakHiddenCount}）`;
    weakLink.addEventListener('click', () => {
      void (handlers.onOpenStrategy ?? (() => handlers.onOpenOptions?.('section-strategy')))();
    });
    card.append(weakLink);
  }

  if (state.mode !== 'auto') {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'diagnostics-button diagnostics-button-primary';
    restore.dataset.qianciRestoreAuto = 'true';
    restore.textContent = '恢复自动标注';
    restore.addEventListener('click', () => {
      void handlers.onRestoreAuto?.();
    });
    card.append(restore);
  }

  return card;
}

function renderSiteControlPanel(state: PopupState, handlers: PopupHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'site-control-panel';

  const current = document.createElement('div');
  current.className = 'site-current-mode';
  current.dataset.qianciCurrentMode = state.mode;
  const modeHint =
    state.mode === 'paused'
      ? '（不标注也不查词）'
      : state.mode === 'manual-only'
        ? '（不划线，仍可选词查词）'
        : '';
  current.textContent = `本站现在：${siteModeLabel(state.mode)}${modeHint}`;
  panel.append(current);

  const actions = document.createElement('div');
  actions.className = 'site-quick-actions';

  // 暂停态只保留恢复自动，避免少标/更稳静默离停
  if (state.mode !== 'paused') {
    const lessButton = document.createElement('button');
    lessButton.type = 'button';
    lessButton.className = 'site-quick-button';
    lessButton.dataset.qianciLessAnnotate = 'true';
    lessButton.textContent = '少标一点';
    const lessAction = resolveLessAnnotateAction(state.mode);
    if (lessAction.kind === 'noop') {
      lessButton.disabled = true;
      lessButton.title = lessAction.reason;
    }
    lessButton.addEventListener('click', () => {
      void handlers.onLessAnnotate?.();
    });
    actions.append(lessButton);

    const stableButton = document.createElement('button');
    stableButton.type = 'button';
    stableButton.className = 'site-quick-button';
    stableButton.dataset.qianciMoreStable = 'true';
    stableButton.textContent = '更稳一点';
    const stableAction = resolveMoreStableAction(state.mode);
    if (stableAction.kind === 'noop') {
      stableButton.disabled = true;
      stableButton.title = stableAction.reason;
    }
    stableButton.addEventListener('click', () => {
      void handlers.onMoreStable?.();
    });
    actions.append(stableButton);

    const pauseButton = document.createElement('button');
    pauseButton.type = 'button';
    pauseButton.className = 'site-quick-button';
    pauseButton.dataset.qianciPauseSite = 'true';
    pauseButton.textContent = '暂停';
    pauseButton.addEventListener('click', () => {
      void handlers.onPauseSite?.();
    });
    actions.append(pauseButton);
  }
  panel.append(actions);

  const advancedToggle = document.createElement('button');
  advancedToggle.type = 'button';
  advancedToggle.className = 'fold-toggle';
  advancedToggle.dataset.qianciToggleSiteAdvanced = 'true';
  advancedToggle.setAttribute('aria-expanded', String(Boolean(state.siteAdvancedOpen)));
  advancedToggle.textContent = state.siteAdvancedOpen ? '▾ 收起更多站点选项' : '▸ 更多站点选项';
  advancedToggle.addEventListener('click', () => {
    void handlers.onToggleSiteAdvanced?.();
  });
  panel.append(advancedToggle);

  if (state.siteAdvancedOpen) {
    const advanced = document.createElement('div');
    advanced.className = 'fold-body site-extra-panel';
    advanced.dataset.qianciSiteAdvanced = 'true';

    const modeList = document.createElement('div');
    modeList.className = 'mode-list';
    for (const item of SITE_MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mode-button';
      button.dataset.qianciSiteMode = item.mode;
      button.setAttribute('aria-pressed', String(state.mode === item.mode));
      button.textContent = item.label;

      const description = document.createElement('span');
      description.className = 'mode-description';
      description.textContent = item.description;
      button.append(description);

      button.addEventListener('click', () => {
        void handlers.onModeChange?.(item.mode);
      });
      modeList.append(button);
    }
    advanced.append(modeList);

    const excludeLabel = document.createElement('label');
    excludeLabel.className = 'site-extra-label';
    excludeLabel.textContent = '排除区域（每行一个选择器，可选）';
    const excludeInput = document.createElement('textarea');
    excludeInput.className = 'site-exclude-input';
    excludeInput.dataset.qianciExcludeSelectors = 'true';
    excludeInput.rows = 3;
    excludeInput.placeholder = '.toolbar\n#sidebar';
    excludeInput.value = state.excludeSelectorsText ?? '';
    excludeInput.setAttribute('aria-label', '站点排除选择器');
    excludeInput.addEventListener('change', () => {
      void handlers.onExcludeSelectorsChange?.(excludeInput.value);
    });
    excludeLabel.append(excludeInput);
    advanced.append(excludeLabel);

    const frameToggle = document.createElement('label');
    frameToggle.className = 'site-extra-toggle';
    const frameCheckbox = document.createElement('input');
    frameCheckbox.type = 'checkbox';
    frameCheckbox.dataset.qianciAllowFrames = 'true';
    frameCheckbox.checked = Boolean(state.allowSameOriginFrames);
    frameCheckbox.addEventListener('change', () => {
      void handlers.onAllowSameOriginFramesChange?.(frameCheckbox.checked);
    });
    const frameText = document.createElement('span');
    frameText.textContent = '允许同源嵌入页标注';
    frameToggle.append(frameCheckbox, frameText);
    advanced.append(frameToggle);

    panel.append(advanced);
  }

  return panel;
}

export function renderPopup(root: HTMLElement, state: PopupState, handlers: PopupHandlers = {}): void {
  root.innerHTML = '';

  const shell = document.createElement('section');
  shell.className = 'popup-shell';

  shell.append(renderStatusCard(state, handlers));
  shell.append(renderSiteControlPanel(state, handlers));
  shell.append(renderLookupPanel(state, handlers));
  shell.append(renderPageToolsPanel(state, handlers));

  const footer = document.createElement('div');
  footer.className = 'popup-footer';

  const retrySummary = document.createElement('button');
  retrySummary.type = 'button';
  retrySummary.className = 'retry-summary-button';
  retrySummary.dataset.qianciOpenRetryQueue = 'true';
  retrySummary.textContent =
    state.retryQueueCount && state.retryQueueCount > 0
      ? `联网重试：${state.retryQueueCount} 个待处理`
      : '联网重试：暂无';
  retrySummary.addEventListener('click', () => {
    void handlers.onOpenOptions?.('online-retry');
  });
  footer.append(retrySummary);

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'settings-button';
  settingsButton.dataset.qianciOpenOptions = 'true';
  settingsButton.textContent = '打开设置';
  settingsButton.addEventListener('click', () => {
    void handlers.onOpenOptions?.();
  });
  footer.append(settingsButton);
  shell.append(footer);

  root.append(shell);
}

function createDefaultDependencies(): PopupDependencies {
  const activeTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      return undefined;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  };

  return {
    async currentUrl() {
      return (await activeTab())?.url;
    },
    store:
      typeof chrome !== 'undefined' && chrome.storage?.local
        ? createChromeStorageAdapter(chrome.storage.local)
        : createMemoryStore(),
    openOptions(section?: string) {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        return;
      }
      const hash = section ? `#${optionsSectionHash(section)}` : '';
      if (hash && chrome.runtime.getURL && chrome.tabs?.create) {
        // openOptionsPage 无法带 hash；用完整 options URL 深链到分组。
        const base = chrome.runtime.getURL('src/options/index.html');
        void chrome.tabs.create({ url: `${base}${hash}` });
        return;
      }
      if (chrome.runtime.openOptionsPage) {
        void chrome.runtime.openOptionsPage();
      }
    },
    async getPageDiagnostics() {
      const tab = await activeTab();
      if (!tab?.id || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        return undefined;
      }

      try {
        return (await chrome.tabs.sendMessage(tab.id, { type: PAGE_DIAGNOSTICS_MESSAGE_TYPE })) as PageDiagnostics;
      } catch {
        return undefined;
      }
    },
    async rescanPage() {
      const tab = await activeTab();
      if (!tab?.id || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        return;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, { type: RESCAN_PAGE_MESSAGE_TYPE });
      } catch {
        return;
      }
    },
    async copyText(text: string) {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('当前浏览器不支持剪贴板写入');
      }

      await navigator.clipboard.writeText(text);
    },
    async extensionVersion() {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
        return chrome.runtime.getManifest().version;
      }

      return 'dev';
    },
    async lookupWord(word: string) {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        return {
          ok: false,
          message: '当前环境无法联网查词',
          errorKind: 'service_unavailable' as const
        };
      }

      try {
        return (await chrome.runtime.sendMessage({
          type: ONLINE_LOOKUP_MESSAGE_TYPE,
          word
        })) as OnlineLookupResult;
      } catch {
        return {
          ok: false,
          message: '联网查词失败',
          errorKind: 'network_error' as const
        };
      }
    }
  };
}

/**
 * 在本地词表与自定义词库中查找词条，避免无必要的联网。
 *
 * @param store 扩展存储。
 * @param word 规范化单词。
 * @returns 本地命中的词条；未命中返回 undefined。
 */
async function resolveLocalLookupEntry(
  store: KeyValueStore,
  word: string
): Promise<{ entry: DictionaryEntry; message: string } | undefined> {
  const customDictionary = await loadCustomDictionary(store);
  const customEntry = customDictionary[word];
  if (customEntry) {
    return {
      entry: customEntry,
      message: `来源：${dictionarySourceLabel(customEntry)}`
    };
  }

  const vocab = await loadVocab(store);
  const vocabItem = vocab.find((item) => item.word === word);
  if (vocabItem?.translation) {
    return {
      entry: {
        word,
        phonetic: '',
        translation: vocabItem.translation,
        rank: 0,
        source: 'online'
      },
      message: '来源：生词本'
    };
  }

  return undefined;
}

export async function mountPopupApp(root: HTMLElement, deps: PopupDependencies = createDefaultDependencies()): Promise<void> {
  const currentUrl = await deps.currentUrl();
  const siteKey = currentUrl ? normalizeSiteKey(currentUrl) : undefined;
  let policies = await loadSitePolicies(deps.store);
  let retryQueue = await loadOnlineLookupQueue(deps.store);
  let profile = (await loadProfile(deps.store)) ?? createProfile('cet4');
  let mode = currentUrl ? getSiteModeForUrl(policies, currentUrl) : 'auto';
  let diagnostics = await deps.getPageDiagnostics?.();
  const extensionVersion = await deps.extensionVersion?.();
  let copyMessage = '';
  let manualCopyReport = '';
  let isRescanning = false;
  let isAdjustingDensity = false;
  let undoDensity: number | undefined;
  let diagnosticsStatusMessage = '';
  let lookupQuery = '';
  let lookupResult: PopupLookupResult | undefined;
  let isLookingUp = false;
  const currentSiteKey = currentUrl ? normalizeSiteKey(currentUrl) : undefined;
  const currentPolicy = currentSiteKey ? policies[currentSiteKey] : undefined;
  let excludeSelectorsText = (currentPolicy?.excludeSelectors ?? []).join('\n');
  let allowSameOriginFrames = Boolean(currentPolicy?.allowSameOriginFrames);
  let siteAdvancedOpen = false;
  let diagnosticsDetailsOpen = false;

  function manualShortcutLabel(shortcut: ManualShortcut = profile.manualShortcut): string {
    return MANUAL_SHORTCUTS.find((item) => item.key === shortcut)?.label ?? 'Alt';
  }

  async function persistSitePolicyPatch(
    patch: { mode?: SiteMode; excludeSelectorsText?: string; allowSameOriginFrames?: boolean },
    statusMessage: string,
    rescan = true
  ): Promise<void> {
    if (!currentUrl) {
      return;
    }

    if (patch.mode) {
      mode = patch.mode;
    }
    if (patch.excludeSelectorsText !== undefined) {
      excludeSelectorsText = patch.excludeSelectorsText;
    }
    if (patch.allowSameOriginFrames !== undefined) {
      allowSameOriginFrames = patch.allowSameOriginFrames;
    }

    diagnosticsStatusMessage = statusMessage;
    copyMessage = '';
    manualCopyReport = '';
    render();

    policies = upsertSitePolicy(
      policies,
      currentUrl,
      {
        mode,
        excludeSelectors: excludeSelectorsText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        allowSameOriginFrames
      },
      Date.now()
    );
    await saveSitePolicies(deps.store, policies);

    try {
      if (rescan && (mode === 'auto' || mode === 'low-density' || mode === 'safe')) {
        await deps.rescanPage?.();
        diagnostics = await deps.getPageDiagnostics?.();
      } else {
        diagnostics = await deps.getPageDiagnostics?.();
      }
    } catch {
      diagnosticsStatusMessage =
        mode === 'auto'
          ? '已恢复自动标注，但当前页刷新失败，请手动重新扫描或刷新页面。'
          : mode === 'low-density' || mode === 'safe'
            ? '已更新站点模式，但当前页刷新失败，请手动重新扫描或刷新页面。'
            : `${siteModeStatusText(mode)} 页面诊断刷新失败，可稍后重新打开 popup 查看。`;
    } finally {
      render();
    }
  }

  /**
   * 密度变更后尽量刷新当前页诊断；刷新失败也要保留已保存的密度变更。
   *
   * @param successMessage 当前页成功刷新后的状态文案。
   * @returns Nothing.
   */
  async function refreshDiagnosticsAfterDensityChange(successMessage: string): Promise<void> {
    if (isAdjustingDensity) {
      return;
    }

    try {
      isAdjustingDensity = true;
      diagnosticsStatusMessage = '';
      copyMessage = '';
      manualCopyReport = '';
      render();
      await deps.rescanPage?.();
      diagnostics = await deps.getPageDiagnostics?.();
      diagnosticsStatusMessage = successMessage;
    } catch {
      diagnosticsStatusMessage = '已调整标注密度，但当前页刷新失败，请手动重新扫描或刷新页面。';
    } finally {
      isAdjustingDensity = false;
    }

    render();
  }

  /**
   * 保存新的标注密度并刷新当前页面诊断。
   *
   * 进入函数时立即设置 busy 状态，避免 Chrome storage 尚未保存完成时重复点击。
   *
   * @param nextDensity 即将保存的新密度。
   * @param previousDensity 用于撤销的旧密度。
   * @param successMessage 刷新成功后的状态文案。
   * @returns Nothing.
   */
  async function saveDensityAndRefresh(
    nextDensity: number,
    previousDensity: number,
    successMessage: string
  ): Promise<void> {
    if (isAdjustingDensity) {
      return;
    }

    try {
      isAdjustingDensity = true;
      diagnosticsStatusMessage = '';
      copyMessage = '';
      manualCopyReport = '';
      render();
      profile = { ...profile, annotationDensity: nextDensity };
      await saveProfile(deps.store, profile);
      undoDensity = previousDensity;
    } catch {
      diagnosticsStatusMessage = '标注密度保存失败，请稍后再试。';
      isAdjustingDensity = false;
      render();
      return;
    } finally {
      if (isAdjustingDensity) {
        isAdjustingDensity = false;
      }
    }

    await refreshDiagnosticsAfterDensityChange(successMessage);
  }

  /**
   * 执行弹窗快速查词：先本地词表/缓存，再联网补查。
   *
   * @param rawQuery 用户输入。
   * @returns Nothing.
   */
  async function runQuickLookup(rawQuery: string): Promise<void> {
    const word = normalizePopupLookupQuery(rawQuery);
    lookupQuery = rawQuery;
    if (!word) {
      lookupResult = {
        status: 'error',
        query: rawQuery.trim(),
        message: '请输入一个英文单词'
      };
      render();
      return;
    }

    if (isLookingUp) {
      return;
    }

    isLookingUp = true;
    lookupResult = { status: 'loading', query: word };
    render();

    try {
      const localHit = await resolveLocalLookupEntry(deps.store, word);
      if (localHit) {
        lookupResult = {
          status: 'found',
          query: word,
          entry: localHit.entry,
          message: localHit.message
        };
        return;
      }

      if (!isOnlineLookupEnabled(profile)) {
        lookupResult = {
          status: 'missing',
          query: word,
          message: '本地没有这个词，且已关闭联网补查'
        };
        return;
      }

      if (!deps.lookupWord) {
        lookupResult = {
          status: 'missing',
          query: word,
          message: '本地没有这个词，且当前无法联网查询'
        };
        return;
      }

      const online = await deps.lookupWord(word);
      if (online.ok && online.entry) {
        const customDictionary = await loadCustomDictionary(deps.store);
        await saveCustomDictionary(
          deps.store,
          upsertOnlineDictionaryEntry(customDictionary, online.entry)
        );
        // 联网补查默认记为不认识，后续页面出现时用下划线标出。
        profile = applyLookupFeedback(profile, word, 'selection', Date.now());
        await saveProfile(deps.store, profile);
        if (!profile.words[word]?.isKnown) {
          const vocab = await loadVocab(deps.store);
          await saveVocab(
            deps.store,
            upsertVocabItem(vocab, {
              word,
              translation: online.entry.translation,
              lastSeenAt: Date.now(),
              lookupCount: 1
            })
          );
        }
        lookupResult = {
          status: 'found',
          query: word,
          entry: online.entry,
          message: `来源：${dictionarySourceLabel(online.entry)}`
        };
        return;
      }

      const failMessage =
        online.queued === true
          ? `${online.message || '联网查询失败'}，已加入重试，可稍后在弹窗查看`
          : online.message || '未找到释义';
      lookupResult = {
        status: online.errorKind === 'not_found' ? 'missing' : 'error',
        query: word,
        message: failMessage
      };
    } catch {
      lookupResult = {
        status: 'error',
        query: word,
        message: '查词失败，请稍后再试'
      };
    } finally {
      isLookingUp = false;
      render();
    }
  }

  const render = (): void => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const lookupInputBefore = root.querySelector<HTMLInputElement>('[data-qianci-lookup-input]');
    const restoreLookupFocus =
      Boolean(lookupInputBefore) && (active === lookupInputBefore || active?.closest?.('[data-qianci-lookup-input]') === lookupInputBefore);
    const selectionStart = lookupInputBefore?.selectionStart ?? null;
    const selectionEnd = lookupInputBefore?.selectionEnd ?? null;

    renderPopup(
      root,
      {
        siteKey,
        mode,
        excludeSelectorsText,
        allowSameOriginFrames,
        retryQueueCount: Object.keys(retryQueue).length,
        extensionVersion,
        diagnostics,
        annotationDensity: profile.annotationDensity,
        isRescanning,
        isAdjustingDensity,
        canUndoDensityChange: undoDensity !== undefined,
        diagnosticsStatusMessage,
        lookupQuery,
        lookupResult,
        isLookingUp,
        manualShortcutLabel: manualShortcutLabel(),
        siteAdvancedOpen,
        diagnosticsDetailsOpen,
        weakHiddenCount: countWeakHiddenWords(profile),
        showFirstRunHint: !profile.onboardingDismissedAt
      },
      {
        onModeChange: async (nextMode) => {
          await persistSitePolicyPatch({ mode: nextMode }, siteModeStatusText(nextMode));
        },
        onLessAnnotate: async () => {
          const action = resolveLessAnnotateAction(mode);
          if (action.kind === 'noop') {
            diagnosticsStatusMessage = action.reason;
            render();
            return;
          }
          if (action.kind === 'reduce-density') {
            const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
            const nextDensity = normalizeAnnotationDensity(currentDensity - QUICK_DENSITY_STEP);
            if (nextDensity === currentDensity) {
              diagnosticsStatusMessage = globalDensityFloorStatusText();
              render();
              return;
            }
            await saveDensityAndRefresh(
              nextDensity,
              currentDensity,
              globalDensityReduceStatusText(nextDensity)
            );
            return;
          }
          if (action.kind === 'mode') {
            await persistSitePolicyPatch({ mode: action.mode }, siteModeStatusText(action.mode));
          }
        },
        onMoreStable: async () => {
          const action = resolveMoreStableAction(mode);
          if (action.kind === 'noop') {
            diagnosticsStatusMessage = action.reason;
            render();
            return;
          }
          if (action.kind === 'mode') {
            await persistSitePolicyPatch({ mode: action.mode }, siteModeStatusText(action.mode));
          }
        },
        onPauseSite: async () => {
          await persistSitePolicyPatch({ mode: 'paused' }, siteModeStatusText('paused'), false);
        },
        onRestoreAuto: async () => {
          await persistSitePolicyPatch({ mode: 'auto' }, siteModeStatusText('auto'));
        },
        onToggleSiteAdvanced: async () => {
          siteAdvancedOpen = !siteAdvancedOpen;
          render();
        },
        onToggleDiagnosticsDetails: async () => {
          diagnosticsDetailsOpen = !diagnosticsDetailsOpen;
          render();
        },
        onExcludeSelectorsChange: async (text) => {
          await persistSitePolicyPatch(
            { excludeSelectorsText: text },
            '已更新站点排除区域。'
          );
        },
        onAllowSameOriginFramesChange: async (enabled) => {
          await persistSitePolicyPatch(
            { allowSameOriginFrames: enabled },
            enabled ? '已允许同源嵌入页标注；请刷新嵌入页后生效。' : '已关闭同源嵌入页标注。',
            false
          );
        },
        onOpenOptions: async (section) => {
          await deps.openOptions(section);
        },
        onOpenStrategy: async () => {
          await deps.openOptions('section-strategy');
        },
        onLookupQueryChange: async (query) => {
          lookupQuery = query;
        },
        onLookupSubmit: async (query) => {
          await runQuickLookup(query);
        },
        onMarkLookupKnown: async (word) => {
          profile = applyKnownFeedback(profile, word, Date.now());
          await saveProfile(deps.store, profile);
          const vocab = await loadVocab(deps.store);
          await saveVocab(deps.store, removeVocabItem(vocab, word));
          lookupResult = {
            status: 'known',
            query: word,
            message: `已将 ${word} 标为认识，之后不会自动标注`
          };
          render();
        },
        onRescanPage: async () => {
          if (isRescanning) {
            return;
          }

          isRescanning = true;
          diagnosticsStatusMessage = '';
          copyMessage = '';
          manualCopyReport = '';
          render();

          try {
            await deps.rescanPage?.();
            diagnostics = await deps.getPageDiagnostics?.();
            diagnosticsStatusMessage = diagnostics
              ? diagnostics.pendingScan
                ? '已开始重新扫描。'
                : '页面诊断已刷新。'
              : '已重新扫描，但当前页面仍暂不可读，可刷新页面后再试。';
          } catch {
            diagnosticsStatusMessage = '重新扫描失败，请刷新页面后再试。';
          } finally {
            isRescanning = false;
            render();
          }
        },
        onIncreaseAnnotationDensity: async () => {
          const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
          const nextDensity = normalizeAnnotationDensity(currentDensity + QUICK_DENSITY_STEP);
          if (nextDensity === currentDensity) {
            diagnosticsStatusMessage = '已经是最多提醒密度。';
            render();
            return;
          }

          await saveDensityAndRefresh(
            nextDensity,
            currentDensity,
            `已提高全局标注密度至 ${Math.round(nextDensity * 100)}%（所有网站），已请求重新扫描本页。`
          );
        },
        onReduceAnnotationDensity: async () => {
          const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
          const nextDensity = normalizeAnnotationDensity(currentDensity - QUICK_DENSITY_STEP);
          if (nextDensity === currentDensity) {
            diagnosticsStatusMessage = globalDensityFloorStatusText();
            render();
            return;
          }

          await saveDensityAndRefresh(
            nextDensity,
            currentDensity,
            `${globalDensityReduceStatusText(nextDensity)}，已请求重新扫描本页。`
          );
        },
        onResetAnnotationDensity: async () => {
          const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
          if (currentDensity === DEFAULT_ANNOTATION_DENSITY) {
            diagnosticsStatusMessage = '已经是默认全局密度。';
            render();
            return;
          }

          await saveDensityAndRefresh(
            DEFAULT_ANNOTATION_DENSITY,
            currentDensity,
            '已恢复默认全局标注密度，已请求重新扫描本页。'
          );
        },
        onUndoAnnotationDensity: async () => {
          if (undoDensity === undefined || isAdjustingDensity) {
            return;
          }

          const previousDensity = undoDensity;
          try {
            isAdjustingDensity = true;
            diagnosticsStatusMessage = '';
            render();
            profile = { ...profile, annotationDensity: previousDensity };
            await saveProfile(deps.store, profile);
            undoDensity = undefined;
          } catch {
            diagnosticsStatusMessage = '撤销全局密度调整失败，请稍后再试。';
            isAdjustingDensity = false;
            render();
            return;
          } finally {
            if (isAdjustingDensity) {
              isAdjustingDensity = false;
            }
          }

          await refreshDiagnosticsAfterDensityChange(
            `已撤销全局密度调整，恢复为 ${Math.round(previousDensity * 100)}%（所有网站），已请求重新扫描本页。`
          );
        },
        onCopyDiagnostics: async (report) => {
          try {
            await deps.copyText?.(report);
            copyMessage = '诊断信息已复制';
            manualCopyReport = '';
          } catch {
            copyMessage = '复制失败，可手动截图反馈';
            manualCopyReport = report;
          }
          render();
        }
      }
    );

    if (restoreLookupFocus) {
      const lookupInput = root.querySelector<HTMLInputElement>('[data-qianci-lookup-input]');
      if (lookupInput) {
        lookupInput.focus();
        if (selectionStart !== null && selectionEnd !== null) {
          try {
            lookupInput.setSelectionRange(selectionStart, selectionEnd);
          } catch {
            // 部分 input type 不支持 selectionRange
          }
        }
      }
    }

    if (copyMessage) {
      const diagnosticsPanel = root.querySelector('.diagnostics-panel');
      const message = document.createElement('p');
      message.className = 'diagnostics-copy diagnostics-status';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      message.textContent = copyMessage;
      diagnosticsPanel?.append(message);

      if (manualCopyReport) {
        const fallback = document.createElement('textarea');
        fallback.className = 'diagnostics-report';
        fallback.dataset.qianciDiagnosticReport = 'true';
        fallback.readOnly = true;
        fallback.value = manualCopyReport;
        diagnosticsPanel?.append(fallback);
        fallback.select();
      }
    }
  };

  render();
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void mountPopupApp(app);
}
