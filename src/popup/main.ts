import './styles.css';
import {
  createProfile,
  DEFAULT_ANNOTATION_DENSITY,
  MAX_ANNOTATION_DENSITY,
  MIN_ANNOTATION_DENSITY,
  normalizeAnnotationDensity
} from '../core/profile';
import {
  PAGE_DIAGNOSTICS_MESSAGE_TYPE,
  RESCAN_PAGE_MESSAGE_TYPE,
  type PageDiagnostics
} from '../core/messages';
import { getSiteModeForUrl, normalizeSiteKey, upsertSitePolicy } from '../core/sitePolicy';
import type { SiteMode } from '../core/types';
import { createChromeStorageAdapter, createMemoryStore, type KeyValueStore } from '../storage/browserAdapter';
import { loadOnlineLookupQueue } from '../storage/onlineLookupQueueStore';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { loadSitePolicies, saveSitePolicies } from '../storage/sitePolicyStore';

export interface PopupState {
  siteKey?: string;
  mode: SiteMode;
  retryQueueCount?: number;
  extensionVersion?: string;
  diagnostics?: PageDiagnostics;
  annotationDensity?: number;
  isRescanning?: boolean;
  isAdjustingDensity?: boolean;
  canUndoDensityChange?: boolean;
  diagnosticsStatusMessage?: string;
}

interface PopupHandlers {
  onModeChange?: (mode: SiteMode) => void | Promise<void>;
  onOpenOptions?: () => void | Promise<void>;
  onRescanPage?: () => void | Promise<void>;
  onIncreaseAnnotationDensity?: () => void | Promise<void>;
  onReduceAnnotationDensity?: () => void | Promise<void>;
  onResetAnnotationDensity?: () => void | Promise<void>;
  onUndoAnnotationDensity?: () => void | Promise<void>;
  onCopyDiagnostics?: (report: string) => void | Promise<void>;
}

export interface PopupDependencies {
  currentUrl(): Promise<string | undefined>;
  store: KeyValueStore;
  openOptions(): void | Promise<void>;
  getPageDiagnostics?(): Promise<PageDiagnostics | undefined>;
  rescanPage?(): Promise<void>;
  copyText?(text: string): Promise<void>;
  extensionVersion?(): Promise<string>;
}

const SITE_MODES: Array<{ mode: SiteMode; label: string; description: string }> = [
  { mode: 'auto', label: '自动标注', description: '正常扫描并标出生词' },
  { mode: 'manual-only', label: '仅手动查词', description: '不自动划线，保留划词和右键查词' },
  { mode: 'paused', label: '暂停潜词', description: '当前站点不标注，也不响应手动查词' }
];
const CROWDED_ANNOTATION_COUNT = 12;
const QUICK_DENSITY_STEP = 0.1;

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

  if (mode === 'manual-only') {
    return '已切到仅手动查词，当前站点不会自动划线。';
  }

  return '已暂停当前站点，潜词不会处理这个站点。';
}

function diagnosticWarningTexts(diagnostics: PageDiagnostics): string[] {
  const warningTexts: string[] = [];
  if (diagnostics.warnings.includes('paused')) {
    warningTexts.push('当前站点已暂停，潜词不会处理这个页面。如需恢复，请切回“自动标注”。');
  }

  if (diagnostics.warnings.includes('manual-only')) {
    warningTexts.push('当前是仅手动查词，不会自动标注。如需自动标注，请切回“自动标注”。');
  }

  if (diagnostics.warnings.includes('dynamic-page')) {
    warningTexts.push('这个页面变化较频繁，潜词会放慢扫描。');
  }

  if (diagnostics.warnings.includes('editor-detected')) {
    warningTexts.push('检测到编辑区，建议切到仅手动查词，避免打断输入。');
  }

  if (diagnostics.warnings.includes('form-heavy')) {
    warningTexts.push('这个页面表单较多，自动标注会更保守。');
  }

  if (diagnostics.warnings.includes('code-heavy')) {
    warningTexts.push('代码内容较多，需要时可划词或右键查词。');
  }

  return warningTexts;
}

/**
 * 在页面可读但没有任何自动标注时，给用户一个不误导的解释。
 *
 * @param diagnostics 当前页面诊断数据。
 * @returns 零标注时的用户提示；不满足条件时返回空字符串。
 */
function diagnosticEmptyAnnotationText(diagnostics: PageDiagnostics): string {
  if (
    diagnostics.pendingScan ||
    diagnostics.annotatedWords > 0 ||
    diagnostics.warnings.length > 0
  ) {
    return '';
  }

  if (diagnostics.scannedTextNodes === 0) {
    return '暂未找到可自动扫描的正文。这个页面可能没有英文正文、内容在受限区域，或正文还没加载出来。可以用 Alt + 选词手动查词，重新扫描本页，或点击“复制反馈模板”反馈这个页面。';
  }

  return '暂未发现需要提醒的词。这通常表示页面可扫描，但当前词汇已认识、低于提醒阈值，或标注密度较保守。如果有漏掉的词，可以用 Alt + 选词手动查词，或点击“重新扫描本页”。';
}

function hasSafeManualModeSuggestion(diagnostics: PageDiagnostics): boolean {
  return (
    diagnostics.warnings.includes('editor-detected') ||
    diagnostics.warnings.includes('form-heavy') ||
    diagnostics.warnings.includes('code-heavy')
  );
}

/**
 * 判断当前页面是否适合显示“少标一些”的快速排错入口。
 *
 * @param state 当前 popup 状态。
 * @returns 页面自动标注较多且密度还可下调时返回 true。
 */
function shouldShowDensityReduction(state: PopupState): boolean {
  if (state.mode !== 'auto' || !state.diagnostics || state.diagnostics.pendingScan) {
    return false;
  }

  const currentDensity = normalizeAnnotationDensity(state.annotationDensity ?? DEFAULT_ANNOTATION_DENSITY);
  return state.diagnostics.annotatedWords >= CROWDED_ANNOTATION_COUNT && currentDensity > MIN_ANNOTATION_DENSITY;
}

/**
 * 判断当前零标注页面是否适合显示“多提醒一点”的快速入口。
 *
 * @param state 当前 popup 状态。
 * @returns 页面可读但无自动标注且密度还可上调时返回 true。
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
 * 判断当前是否适合显示“恢复平衡”密度入口。
 *
 * @param state 当前 popup 状态。
 * @returns 自动模式下密度偏离默认值且页面状态稳定时返回 true。
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

function renderDiagnosticsPanel(state: PopupState, handlers: PopupHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'diagnostics-panel';
  const isDiagnosticsBusy = Boolean(state.isRescanning || state.isAdjustingDensity);
  panel.setAttribute('aria-busy', isDiagnosticsBusy ? 'true' : 'false');

  const title = document.createElement('div');
  title.className = 'diagnostics-title';
  title.textContent = '页面诊断';
  panel.append(title);

  if (state.isRescanning || state.isAdjustingDensity || state.diagnosticsStatusMessage) {
    const status = document.createElement('p');
    status.className = 'diagnostics-copy diagnostics-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.textContent = state.isRescanning
      ? '正在重新扫描本页...'
      : state.isAdjustingDensity
        ? '正在调整标注密度...'
        : state.diagnosticsStatusMessage ?? '';
    panel.append(status);
  }

  if (state.canUndoDensityChange && !state.isAdjustingDensity && !state.isRescanning) {
    const undoDensityButton = document.createElement('button');
    undoDensityButton.type = 'button';
    undoDensityButton.className = 'diagnostics-button';
    undoDensityButton.dataset.qianciUndoDensity = 'true';
    undoDensityButton.textContent = '撤销密度调整';
    undoDensityButton.addEventListener('click', () => {
      void handlers.onUndoAnnotationDensity?.();
    });
    panel.append(undoDensityButton);
  }

  if (!state.diagnostics) {
    const empty = document.createElement('p');
    empty.className = 'diagnostics-copy';
    empty.textContent =
      '当前页面暂不可读。可以先点击“重新扫描本页”，刷新页面后再试；仍不可用时可复制反馈模板，帮助定位兼容问题。';
    panel.append(empty);

    const rescanButton = document.createElement('button');
    rescanButton.type = 'button';
    rescanButton.className = 'diagnostics-button';
    rescanButton.dataset.qianciRescanPage = 'true';
    rescanButton.disabled = isDiagnosticsBusy;
    rescanButton.setAttribute('aria-busy', isDiagnosticsBusy ? 'true' : 'false');
    rescanButton.setAttribute('aria-label', isDiagnosticsBusy ? '当前页面诊断正在更新' : '重新扫描本页');
    rescanButton.textContent = state.isRescanning ? '正在重新扫描...' : '重新扫描本页';
    rescanButton.addEventListener('click', () => {
      void handlers.onRescanPage?.();
    });
    panel.append(rescanButton);

    panel.append(createCopyDiagnosticsButton(state, handlers));
    panel.append(createCopyFeedbackTemplateButton(state, handlers));
    return panel;
  }

  const summary = document.createElement('p');
  summary.className = 'diagnostics-copy';
  summary.textContent = `已标注 ${state.diagnostics.annotatedWords} 个词 · 已检查文本 ${state.diagnostics.scannedTextNodes} 段`;
  panel.append(summary);

  const meta = document.createElement('p');
  meta.className = 'diagnostics-copy';
  meta.textContent = diagnosticStatusText(state.diagnostics);
  panel.append(meta);

  const warningTexts = diagnosticWarningTexts(state.diagnostics);
  for (const warningText of warningTexts) {
    const warning = document.createElement('p');
    warning.className = 'diagnostics-copy diagnostics-warning';
    warning.textContent = warningText;
    panel.append(warning);
  }

  const emptyAnnotationText = diagnosticEmptyAnnotationText(state.diagnostics);
  if (emptyAnnotationText) {
    const emptyAnnotation = document.createElement('p');
    emptyAnnotation.className = 'diagnostics-copy diagnostics-empty';
    emptyAnnotation.textContent = emptyAnnotationText;
    panel.append(emptyAnnotation);
  }

  if (shouldShowDensityIncrease(state)) {
    const densityHelp = document.createElement('p');
    densityHelp.className = 'diagnostics-copy diagnostics-density-help';
    densityHelp.textContent = '想多提醒一点？可以调高标注密度，不会改变熟词或生词记录。';
    panel.append(densityHelp);

    const increaseDensityButton = document.createElement('button');
    increaseDensityButton.type = 'button';
    increaseDensityButton.className = 'diagnostics-button';
    increaseDensityButton.dataset.qianciIncreaseDensity = 'true';
    increaseDensityButton.disabled = Boolean(state.isAdjustingDensity);
    increaseDensityButton.setAttribute('aria-busy', state.isAdjustingDensity ? 'true' : 'false');
    increaseDensityButton.textContent = '多提醒一点';
    increaseDensityButton.addEventListener('click', () => {
      void handlers.onIncreaseAnnotationDensity?.();
    });
    panel.append(increaseDensityButton);
  }

  if (state.mode === 'auto' && hasSafeManualModeSuggestion(state.diagnostics)) {
    const safeModeButton = document.createElement('button');
    safeModeButton.type = 'button';
    safeModeButton.className = 'diagnostics-button diagnostics-button-primary';
    safeModeButton.dataset.qianciSafeManualMode = 'true';
    safeModeButton.textContent = '切到仅手动查词';
    safeModeButton.addEventListener('click', () => {
      void handlers.onModeChange?.('manual-only');
    });
    panel.append(safeModeButton);
  }

  if (shouldShowDensityReduction(state)) {
    const densityHelp = document.createElement('p');
    densityHelp.className = 'diagnostics-copy diagnostics-density-help';
    densityHelp.textContent = '标注有点多？可以先少标一些，不会删除学习记录。';
    panel.append(densityHelp);

    const reduceDensityButton = document.createElement('button');
    reduceDensityButton.type = 'button';
    reduceDensityButton.className = 'diagnostics-button';
    reduceDensityButton.dataset.qianciReduceDensity = 'true';
    reduceDensityButton.disabled = Boolean(state.isAdjustingDensity);
    reduceDensityButton.setAttribute('aria-busy', state.isAdjustingDensity ? 'true' : 'false');
    reduceDensityButton.textContent = '少标一些';
    reduceDensityButton.addEventListener('click', () => {
      void handlers.onReduceAnnotationDensity?.();
    });
    panel.append(reduceDensityButton);
  }

  if (shouldShowDensityReset(state)) {
    const resetDensityHelp = document.createElement('p');
    resetDensityHelp.className = 'diagnostics-copy diagnostics-density-help';
    resetDensityHelp.textContent = '只恢复默认标注密度，不改变学习记录或站点模式。';
    panel.append(resetDensityHelp);

    const resetDensityButton = document.createElement('button');
    resetDensityButton.type = 'button';
    resetDensityButton.className = 'diagnostics-button';
    resetDensityButton.dataset.qianciResetDensity = 'true';
    resetDensityButton.disabled = Boolean(state.isAdjustingDensity);
    resetDensityButton.setAttribute('aria-busy', state.isAdjustingDensity ? 'true' : 'false');
    resetDensityButton.textContent = '恢复平衡';
    resetDensityButton.addEventListener('click', () => {
      void handlers.onResetAnnotationDensity?.();
    });
    panel.append(resetDensityButton);
  }

  const rescanButton = document.createElement('button');
  rescanButton.type = 'button';
  rescanButton.className = 'diagnostics-button';
  rescanButton.dataset.qianciRescanPage = 'true';
  rescanButton.disabled = isDiagnosticsBusy;
  rescanButton.setAttribute('aria-busy', isDiagnosticsBusy ? 'true' : 'false');
  rescanButton.setAttribute('aria-label', isDiagnosticsBusy ? '当前页面诊断正在更新' : '重新扫描本页');
  rescanButton.textContent = state.isRescanning ? '正在重新扫描...' : '重新扫描本页';
  rescanButton.addEventListener('click', () => {
    void handlers.onRescanPage?.();
  });
  panel.append(rescanButton);

  panel.append(createCopyDiagnosticsButton(state, handlers));
  panel.append(createCopyFeedbackTemplateButton(state, handlers));

  return panel;
}

export function renderPopup(root: HTMLElement, state: PopupState, handlers: PopupHandlers = {}): void {
  root.innerHTML = '';

  const shell = document.createElement('section');
  shell.className = 'popup-shell';

  const header = document.createElement('header');
  header.className = 'popup-header';
  header.innerHTML = '<h1>潜词</h1><p>当前站点</p>';
  shell.append(header);

  const siteKey = document.createElement('div');
  siteKey.className = 'site-key';
  siteKey.textContent = state.siteKey ?? '无法识别当前站点';
  shell.append(siteKey);

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
  shell.append(modeList);
  shell.append(renderDiagnosticsPanel(state, handlers));

  const retrySummary = document.createElement('button');
  retrySummary.type = 'button';
  retrySummary.className = 'retry-summary-button';
  retrySummary.dataset.qianciOpenRetryQueue = 'true';
  retrySummary.textContent =
    state.retryQueueCount && state.retryQueueCount > 0
      ? `联网补查：${state.retryQueueCount} 个待重试`
      : '联网补查：暂无待重试';
  retrySummary.addEventListener('click', () => {
    void handlers.onOpenOptions?.();
  });
  shell.append(retrySummary);

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'settings-button';
  settingsButton.dataset.qianciOpenOptions = 'true';
  settingsButton.textContent = '打开完整设置';
  settingsButton.addEventListener('click', () => {
    void handlers.onOpenOptions?.();
  });
  shell.append(settingsButton);

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
    openOptions() {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
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
    }
  };
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

  const render = (): void => {
    renderPopup(
      root,
      {
        siteKey,
        mode,
        retryQueueCount: Object.keys(retryQueue).length,
        extensionVersion,
        diagnostics,
        annotationDensity: profile.annotationDensity,
        isRescanning,
        isAdjustingDensity,
        canUndoDensityChange: undoDensity !== undefined,
        diagnosticsStatusMessage
      },
      {
        onModeChange: async (nextMode) => {
          if (!currentUrl) {
            return;
          }

          mode = nextMode;
          diagnosticsStatusMessage = siteModeStatusText(nextMode);
          copyMessage = '';
          manualCopyReport = '';
          render();

          policies = upsertSitePolicy(policies, currentUrl, nextMode, Date.now());
          await saveSitePolicies(deps.store, policies);

          try {
            if (nextMode === 'auto') {
              await deps.rescanPage?.();
              diagnostics = await deps.getPageDiagnostics?.();
            } else {
              diagnostics = await deps.getPageDiagnostics?.();
            }
          } catch {
            diagnosticsStatusMessage =
              nextMode === 'auto'
                ? '已恢复自动标注，但当前页刷新失败，请手动重新扫描或刷新页面。'
                : `${siteModeStatusText(nextMode)} 页面诊断刷新失败，可稍后重新打开 popup 查看。`;
          } finally {
            render();
          }
        },
        onOpenOptions: async () => {
          await deps.openOptions();
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
            `已调高标注密度：${Math.round(nextDensity * 100)}%，已请求重新扫描本页。`
          );
        },
        onReduceAnnotationDensity: async () => {
          const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
          const nextDensity = normalizeAnnotationDensity(currentDensity - QUICK_DENSITY_STEP);
          if (nextDensity === currentDensity) {
            diagnosticsStatusMessage = '已经是最少标注密度。';
            render();
            return;
          }

          await saveDensityAndRefresh(
            nextDensity,
            currentDensity,
            `已调低标注密度：${Math.round(nextDensity * 100)}%，已请求重新扫描本页。`
          );
        },
        onResetAnnotationDensity: async () => {
          const currentDensity = normalizeAnnotationDensity(profile.annotationDensity);
          if (currentDensity === DEFAULT_ANNOTATION_DENSITY) {
            diagnosticsStatusMessage = '已经是平衡标注密度。';
            render();
            return;
          }

          await saveDensityAndRefresh(
            DEFAULT_ANNOTATION_DENSITY,
            currentDensity,
            '已恢复平衡标注密度，已请求重新扫描本页。'
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
            diagnosticsStatusMessage = '撤销标注密度调整失败，请稍后再试。';
            isAdjustingDensity = false;
            render();
            return;
          } finally {
            if (isAdjustingDensity) {
              isAdjustingDensity = false;
            }
          }

          await refreshDiagnosticsAfterDensityChange(
            `已撤销标注密度调整，恢复为 ${Math.round(previousDensity * 100)}%，已请求重新扫描本页。`
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
