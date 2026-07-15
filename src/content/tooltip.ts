import type { DictionaryEntry } from '../core/dictionaryEntry';
import { compactGloss, dictionarySourceLabel } from '../core/dictionarySource';
import type { RectLike } from './placement';
import { chooseTooltipPlacement } from './placement';

export interface TooltipController {
  showEntry(
    anchor: HTMLElement | RectLike,
    entry: DictionaryEntry,
    onKnown: () => void,
    onAlwaysAnnotate: () => void,
    options?: TooltipShowOptions
  ): void;
  showMissing(anchor: HTMLElement | RectLike, word: string, onLookup: () => void, message?: string, options?: TooltipShowOptions): void;
  showLoading(anchor: HTMLElement | RectLike, word: string, options?: TooltipShowOptions): void;
  showKnownNotice(anchor: HTMLElement | RectLike, word: string, onUndo: () => void): void;
  showAlwaysAnnotateNotice(anchor: HTMLElement | RectLike, word: string, onUndo: () => void): void;
  cancelHide(): void;
  scheduleHide(): void;
  /**
   * 判断事件目标是否属于查词卡片（含 Shadow 宿主）。
   * 用于标注词 mouseleave 时判断指针是否已移入卡片。
   */
  ownsEventTarget(target: EventTarget | null): boolean;
  hide(): void;
  version(): number;
  updateFocusColor(color: string): void;
  dispose(): void;
}

export interface TooltipShowOptions {
  focusPrimaryAction?: boolean;
  returnFocusTo?: HTMLElement;
  announceStatus?: boolean;
  /**
   * 用户保存自定义释义或标记释义不准时调用。
   * @param word 单词
   * @param translation 新释义；未提供时表示仅记录问题并用旧释义入自定义库
   */
  onTranslationFeedback?: (word: string, translation?: string) => void;
  /** 是否展示联网查询按钮；关闭联网补查时为 false。 */
  showOnlineLookup?: boolean;
}

const TOOLTIP_WIDTH = 220;
const TOOLTIP_HEIGHT = 108;
/** 词与卡片之间常有 8–20px 空隙，过短会导致指针还没移入卡片就消失。 */
const HIDE_DELAY_MS = 420;
const OCCLUSION_SAMPLE_X = [0.15, 0.5, 0.85];

interface TextLineOptions {
  role?: string;
  ariaLive?: 'polite' | 'assertive' | 'off';
}

function appendTextLine(
  root: Document | ShadowRoot,
  parent: HTMLElement,
  text: string,
  className: string,
  options: TextLineOptions = {}
): void {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument;
  const line = ownerDocument.createElement('div');
  line.className = className;
  line.textContent = text;
  if (options.role) {
    line.setAttribute('role', options.role);
  }
  if (options.ariaLive) {
    line.setAttribute('aria-live', options.ariaLive);
  }
  parent.append(line);
}

function compactTranslation(text: string): string {
  return compactGloss(text);
}

/**
 * Converts an entry into wording users can understand (A4).
 */
function sourceLabel(entry: DictionaryEntry): string {
  return dictionarySourceLabel(entry);
}

export function createTooltipController(doc: Document): TooltipController {
  const tooltipHost = doc.createElement('div');
  tooltipHost.dataset.qianciTooltip = 'true';
  tooltipHost.setAttribute('role', 'dialog');
  tooltipHost.setAttribute('aria-modal', 'false');
  tooltipHost.style.position = 'fixed';
  tooltipHost.style.zIndex = '2147483647';
  tooltipHost.style.width = `${TOOLTIP_WIDTH}px`;
  tooltipHost.style.boxSizing = 'border-box';
  tooltipHost.style.display = 'none';
  tooltipHost.style.pointerEvents = 'auto';
  const shadowRoot = tooltipHost.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }

    .qianci-tooltip-card {
      box-sizing: border-box;
      width: ${TOOLTIP_WIDTH}px;
      padding: 8px 10px;
      border: 1px solid rgba(70, 66, 58, 0.18);
      border-radius: 6px;
      background: #fffefc;
      color: #202020;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      font: 12px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
    }

    .qianci-tooltip-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    strong {
      font-size: 13px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .qianci-tooltip-actions {
      display: flex;
      flex-wrap: wrap;
      flex-shrink: 0;
      gap: 4px;
      max-width: 136px;
      justify-content: flex-end;
    }

    button {
      border: 0;
      border-radius: 4px;
      min-width: 32px;
      min-height: 32px;
      padding: 4px 6px;
      background: #f1f0ec;
      color: #555;
      font: 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer;
    }

    button:focus-visible {
      outline: 2px solid var(--qianci-focus-color, #2563eb);
      outline-offset: 2px;
    }

    .qianci-tooltip-close {
      background: transparent;
      color: #7a7368;
    }

    .qianci-tooltip-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
      font-size: 11px;
      color: #7a7368;
    }

    .qianci-source-pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 7px;
      border: 1px solid rgba(95, 125, 185, 0.18);
      border-radius: 999px;
      background: rgba(95, 125, 185, 0.08);
      color: #405d96;
      font-weight: 600;
    }

    .qianci-feedback-link {
      min-height: 22px;
      padding: 2px 4px;
      background: transparent;
      color: #7a7368;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .qianci-more-panel {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(70, 66, 58, 0.12);
    }

    .qianci-edit-form {
      display: grid;
      gap: 6px;
      margin-top: 6px;
    }

    .qianci-edit-input {
      box-sizing: border-box;
      width: 100%;
      min-height: 32px;
      padding: 4px 6px;
      border: 1px solid rgba(70, 66, 58, 0.2);
      border-radius: 4px;
      background: #fff;
      color: #202020;
      font: 12px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
    }

    .qianci-edit-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    a {
      color: inherit;
      text-decoration: none;
    }
  `;
  shadowRoot.append(style);
  let hideTimer = 0;
  let returnFocusTarget: HTMLElement | undefined;
  let expandedTrigger: HTMLElement | undefined;
  let displayVersion = 0;
  let pointerOverTooltip = false;

  function ensureMounted(): void {
    if (!tooltipHost.isConnected) {
      doc.body.append(tooltipHost);
    }
  }

  function cancelHide(): void {
    if (!hideTimer) {
      return;
    }
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  /**
   * 指针是否仍停在查词卡片或触发标注词上。
   * matches(':hover') 覆盖“还没收到 mouseenter 但指针已在元素上”的间隙。
   */
  function shouldKeepOpenForPointer(): boolean {
    if (pointerOverTooltip) {
      return true;
    }

    if (tooltipHost.style.display !== 'none') {
      try {
        if (tooltipHost.matches(':hover')) {
          return true;
        }
      } catch {
        // jsdom 等环境可能不支持 :hover，忽略即可。
      }
    }

    if (expandedTrigger?.isConnected) {
      try {
        if (expandedTrigger.matches(':hover')) {
          return true;
        }
      } catch {
        // 同上。
      }
    }

    return false;
  }

  function ownsEventTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }

    if (target === tooltipHost || tooltipHost.contains(target)) {
      return true;
    }

    // Shadow 内部节点：contains 在部分路径下拿不到，回退到 composed root。
    if (target instanceof Element) {
      const root = target.getRootNode();
      if (root instanceof ShadowRoot && root.host === tooltipHost) {
        return true;
      }
    }

    return false;
  }

  function hideNow(): void {
    cancelHide();
    pointerOverTooltip = false;
    tooltipHost.style.display = 'none';
    shadowRoot.querySelector('.qianci-tooltip-card')?.remove();
    displayVersion += 1;
    collapseExpandedTrigger();
  }

  /**
   * 清除当前触发词的展开状态。
   *
   * @returns Nothing.
   */
  function collapseExpandedTrigger(): void {
    expandedTrigger?.setAttribute('aria-expanded', 'false');
    expandedTrigger = undefined;
  }

  /**
   * 标记当前标注词已经打开查词卡片。
   *
   * @param anchor 触发卡片的页面元素或虚拟位置。
   * @returns Nothing.
   */
  function expandTrigger(anchor: HTMLElement | RectLike): void {
    collapseExpandedTrigger();

    if (!('dataset' in anchor) || !anchor.dataset.qianciWord) {
      return;
    }

    expandedTrigger = anchor;
    expandedTrigger.setAttribute('aria-expanded', 'true');
  }

  /**
   * 在用户用 Escape 主动关闭键盘打开的卡片时，把焦点还给触发词。
   *
   * @returns Nothing.
   */
  function restoreFocusTarget(): void {
    const target = returnFocusTarget;
    returnFocusTarget = undefined;

    if (!target?.isConnected) {
      return;
    }

    target.focus();
  }

  /**
   * 为即将被移除的标注词寻找后续键盘落点，优先保持阅读顺序。
   *
   * @returns 下一个或上一个标注词；没有可用候选时返回最近正文容器。
   */
  function fallbackAnnotatedWord(): HTMLElement | undefined {
    const target = returnFocusTarget;
    if (!target?.isConnected) {
      return undefined;
    }

    const words = Array.from(doc.querySelectorAll<HTMLElement>('[data-qianci-word]'));
    const targetIndex = words.indexOf(target);
    if (targetIndex < 0) {
      return undefined;
    }

    return words[targetIndex + 1] ?? words[targetIndex - 1] ?? fallbackReadingContainer(target);
  }

  /**
   * 当页面只剩一个标注词时，选择最近正文容器作为键盘焦点落点。
   *
   * @param target 即将被操作移除的标注词。
   * @returns 可程序化聚焦的正文容器。
   */
  function fallbackReadingContainer(target: HTMLElement): HTMLElement | undefined {
    const container = target.closest<HTMLElement>('article, main, section, p, li, blockquote, body');
    if (!container) {
      return undefined;
    }

    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }

    return container;
  }

  /**
   * 恢复到原触发词；如果触发词被动作移除，则落到相邻标注词。
   *
   * @param fallback 原触发词消失时的备用焦点目标。
   * @returns Nothing.
   */
  function restoreFocusTargetOrFallback(fallback?: HTMLElement): void {
    const target = returnFocusTarget;
    returnFocusTarget = undefined;

    if (target?.isConnected) {
      target.focus();
      return;
    }

    if (fallback?.isConnected) {
      fallback.focus();
    }
  }

  /**
   * 创建查词卡片的显式关闭按钮，给不熟悉 Escape 的用户一个可见出口。
   *
   * @returns 可追加到动作区的关闭按钮。
   */
  function createCloseButton(): HTMLButtonElement {
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'qianci-tooltip-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '关闭查词卡片');
    closeButton.onclick = () => {
      hideNow();
      restoreFocusTarget();
    };
    return closeButton;
  }

  /**
   * 包装会关闭卡片的动作，让键盘打开的卡片在动作结束后回到阅读位置。
   *
   * @param action 原始按钮动作。
   * @returns 带焦点恢复的按钮动作。
   */
  function actionWithFocusRestore(action: () => void): () => void {
    return () => {
      const fallback = fallbackAnnotatedWord();
      action();
      restoreFocusTargetOrFallback(fallback);
    };
  }

  /**
   * 允许键盘用户用 Escape 关闭当前释义卡片。
   *
   * @param event 当前键盘事件。
   * @returns Nothing.
   */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || tooltipHost.style.display === 'none') {
      return;
    }

    hideNow();
    restoreFocusTarget();
  }

  /**
   * 非模态卡片在用户点击页面其它区域时立即收起，内部点击通过 composedPath 保留。
   *
   * @param event 当前指针事件。
   * @returns Nothing.
   */
  function handleOutsidePointerDown(event: Event): void {
    if (tooltipHost.style.display === 'none') {
      return;
    }

    if (event.composedPath().includes(tooltipHost)) {
      return;
    }

    hideNow();
  }

  function scheduleHide(): void {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      if (shadowRoot.activeElement) {
        return;
      }

      if (shouldKeepOpenForPointer()) {
        return;
      }

      pointerOverTooltip = false;
      tooltipHost.style.display = 'none';
      shadowRoot.querySelector('.qianci-tooltip-card')?.remove();
      displayVersion += 1;
      collapseExpandedTrigger();
    }, HIDE_DELAY_MS);
  }

  function handleTooltipPointerEnter(): void {
    pointerOverTooltip = true;
    cancelHide();
  }

  function handleTooltipPointerLeave(): void {
    pointerOverTooltip = false;
    scheduleHide();
  }

  /**
   * 焦点进入查词卡片后取消旧的 hover 隐藏任务，避免卡片在操作中消失。
   *
   * @returns Nothing.
   */
  function handleFocusIn(): void {
    cancelHide();
  }

  /**
   * 焦点离开查词卡片后再延迟隐藏，符合 hover/focus 内容的可操作要求。
   *
   * @param event 当前焦点离开事件。
   * @returns Nothing.
   */
  function handleFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && tooltipHost.contains(nextTarget)) {
      return;
    }

    scheduleHide();
  }

  /**
   * Detects fixed or sticky elements occupying the top of the viewport.
   *
   * @returns Bottom edge of the top occlusion area in viewport coordinates.
   */
  function topOcclusionInset(): number {
    const view = doc.defaultView ?? window;
    if (typeof doc.elementsFromPoint !== 'function') {
      return 0;
    }

    const sampleY = 1;
    let inset = 0;
    for (const ratio of OCCLUSION_SAMPLE_X) {
      const x = Math.max(0, Math.floor((view.innerWidth || 1280) * ratio));
      for (const element of doc.elementsFromPoint(x, sampleY)) {
        if (!(element instanceof HTMLElement) || element === tooltipHost || tooltipHost.contains(element)) {
          continue;
        }

        const style = view.getComputedStyle(element);
        if (style.position !== 'fixed' && style.position !== 'sticky') {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top <= sampleY && rect.bottom > sampleY) {
          inset = Math.max(inset, rect.bottom);
        }
      }
    }
    return inset;
  }

  /**
   * Detects fixed or sticky elements occupying the bottom of the viewport.
   *
   * @returns Height of the bottom occlusion area in viewport coordinates.
   */
  function bottomOcclusionInset(): number {
    const view = doc.defaultView ?? window;
    if (typeof doc.elementsFromPoint !== 'function') {
      return 0;
    }

    const viewportHeight = view.innerHeight || 900;
    const sampleY = Math.max(0, viewportHeight - 1);
    let inset = 0;
    for (const ratio of OCCLUSION_SAMPLE_X) {
      const x = Math.max(0, Math.floor((view.innerWidth || 1280) * ratio));
      for (const element of doc.elementsFromPoint(x, sampleY)) {
        if (!(element instanceof HTMLElement) || element === tooltipHost || tooltipHost.contains(element)) {
          continue;
        }

        const style = view.getComputedStyle(element);
        if (style.position !== 'fixed' && style.position !== 'sticky') {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top < sampleY && rect.bottom >= sampleY) {
          inset = Math.max(inset, viewportHeight - rect.top);
        }
      }
    }
    return inset;
  }

  /**
   * 按卡片真实高度定位；展开「更多」或内联编辑后应再调用一次。
   */
  function place(anchor: HTMLElement | RectLike): void {
    const rect =
      'getBoundingClientRect' in anchor
        ? anchor.getBoundingClientRect()
        : { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height };
    const view = doc.defaultView ?? window;
    const card = shadowRoot.querySelector('.qianci-tooltip-card') as HTMLElement | null;
    const measuredHeight = card?.getBoundingClientRect().height ?? 0;
    const height = measuredHeight > 0 ? measuredHeight : TOOLTIP_HEIGHT;
    const placement = chooseTooltipPlacement(
      { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      { width: view.innerWidth || 1280, height: view.innerHeight || 900 },
      { width: TOOLTIP_WIDTH, height },
      { topInset: topOcclusionInset(), bottomInset: bottomOcclusionInset() }
    );

    tooltipHost.style.left = `${placement.x}px`;
    tooltipHost.style.top = `${placement.y}px`;
    tooltipHost.style.display = 'block';
  }

  function render(anchor: HTMLElement | RectLike, label: string, busy: boolean, build: (card: HTMLElement) => void): void {
    cancelHide();
    ensureMounted();
    tooltipHost.setAttribute('aria-label', label);
    tooltipHost.setAttribute('aria-busy', busy ? 'true' : 'false');
    expandTrigger(anchor);
    shadowRoot.querySelector('.qianci-tooltip-card')?.remove();
    displayVersion += 1;
    const card = doc.createElement('div');
    card.className = 'qianci-tooltip-card';
    build(card);
    shadowRoot.append(card);
    place(anchor);
  }

  /**
   * 内容高度变化后按真实尺寸重新放置（导出给测试/内部复用）。
   */
  function reposition(anchor: HTMLElement | RectLike): void {
    place(anchor);
  }

  /**
   * Adds compact source and feedback metadata to the entry card.
   *
   * @param parent Tooltip card that receives metadata.
   * @param entry Dictionary entry currently displayed.
   * @param onFeedback Optional translation quality feedback callback.
   * @param anchor Anchor used to keep the acknowledgement card in place.
   * @returns Nothing.
   */
  function appendEntryMeta(
    parent: HTMLElement,
    entry: DictionaryEntry,
    onFeedback: ((word: string) => void) | undefined,
    anchor: HTMLElement | RectLike
  ): void {
    const meta = doc.createElement('div');
    meta.className = 'qianci-tooltip-meta';

    const sourcePrefix = doc.createElement('span');
    sourcePrefix.textContent = '来源：';
    meta.append(sourcePrefix);

    const sourcePill = doc.createElement('span');
    sourcePill.className = 'qianci-source-pill';
    sourcePill.dataset.qianciSourcePill = 'true';
    sourcePill.textContent = sourceLabel(entry);
    sourcePill.setAttribute('aria-label', `词条来源：${sourceLabel(entry)}`);
    meta.append(sourcePill);

    appendAttributionLinks(meta, entry);
    // 释义反馈已改到「更多 → 改释义」内联编辑，meta 仅保留来源。
    void onFeedback;
    parent.append(meta);
  }

  /**
   * Adds provider attribution links when the entry came from an external source.
   *
   * @param meta Metadata row that receives attribution links.
   * @param entry Dictionary entry currently displayed.
   * @returns Nothing.
   */
  function appendAttributionLinks(meta: HTMLElement, entry: DictionaryEntry): void {
    if (!entry.attribution) {
      return;
    }

    meta.append(doc.createTextNode(' · '));

    const source = doc.createElement('a');
    source.href = entry.attribution.url;
    source.target = '_blank';
    source.rel = 'noreferrer';
    source.textContent = entry.attribution.label;
    meta.append(source);

    if (entry.attribution.serviceUrl) {
      meta.append(doc.createTextNode(' · '));

      const service = doc.createElement('a');
      service.href = entry.attribution.serviceUrl;
      service.target = '_blank';
      service.rel = 'noreferrer';
      service.textContent = entry.attribution.serviceLabel ?? 'FreeDictionaryAPI';
      meta.append(service);
    }

    if (entry.attribution.translationServiceUrl) {
      meta.append(doc.createTextNode(' · 中文：'));

      const translationService = doc.createElement('a');
      translationService.href = entry.attribution.translationServiceUrl;
      translationService.target = '_blank';
      translationService.rel = 'noreferrer';
      translationService.textContent = entry.attribution.translationServiceLabel ?? '机器翻译';
      meta.append(translationService);
    }
  }

  /**
   * 在卡片内联编辑并保存自定义释义。
   */
  function showInlineTranslationEditor(
    anchor: HTMLElement | RectLike,
    entry: DictionaryEntry,
    onFeedback: (word: string, translation?: string) => void
  ): void {
    cancelHide();
    const card = shadowRoot.querySelector('.qianci-tooltip-card');
    if (!card) {
      return;
    }

    card.querySelector('.qianci-edit-form')?.remove();
    const form = doc.createElement('form');
    form.className = 'qianci-edit-form';
    form.dataset.qianciEditTranslation = 'true';

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'qianci-edit-input';
    input.dataset.qianciEditTranslationInput = 'true';
    input.value = compactTranslation(entry.translation);
    input.setAttribute('aria-label', `修改 ${entry.word} 的中文释义`);
    form.append(input);

    const actions = doc.createElement('div');
    actions.className = 'qianci-edit-actions';

    const save = doc.createElement('button');
    save.type = 'submit';
    save.textContent = '保存';
    save.dataset.qianciSaveTranslation = 'true';

    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.onclick = () => {
      form.remove();
    };

    actions.append(save, cancel);
    form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = input.value.trim();
      if (!next) {
        input.focus();
        return;
      }
      onFeedback(entry.word, next);
      showTranslationSavedNotice(anchor, entry.word, next);
    });
    card.append(form);
    input.focus();
    input.select();
  }

  function showTranslationSavedNotice(anchor: HTMLElement | RectLike, word: string, translation: string): void {
    render(anchor, `潜词释义已更新：${word}`, false, (card) => {
      const header = doc.createElement('div');
      header.className = 'qianci-tooltip-header';
      const label = doc.createElement('strong');
      label.textContent = '已保存自定义释义';
      header.append(label);
      const actions = doc.createElement('div');
      actions.className = 'qianci-tooltip-actions';
      actions.append(createCloseButton());
      header.append(actions);
      card.append(header);
      appendTextLine(shadowRoot, card, `${word}：${translation}`, 'qianci-tooltip-translation', {
        role: 'status',
        ariaLive: 'polite'
      });
    });
  }

  tooltipHost.addEventListener('mouseenter', handleTooltipPointerEnter);
  tooltipHost.addEventListener('mouseleave', handleTooltipPointerLeave);
  tooltipHost.addEventListener('focusin', handleFocusIn);
  tooltipHost.addEventListener('focusout', handleFocusOut);
  doc.addEventListener('keydown', handleKeydown);
  doc.addEventListener('pointerdown', handleOutsidePointerDown);
  tooltipHost.style.setProperty('--qianci-focus-color', '#2563eb');

  return {
    showEntry(anchor, entry, onKnown, onAlwaysAnnotate, options = {}) {
      let primaryAction: HTMLButtonElement | undefined;
      returnFocusTarget = options.returnFocusTo;
      render(anchor, `潜词查词卡片：${entry.word}`, false, (card) => {
        const header = doc.createElement('div');
        header.className = 'qianci-tooltip-header';

        const word = doc.createElement('strong');
        word.textContent = entry.word;
        header.append(word);

        const actions = doc.createElement('div');
        actions.className = 'qianci-tooltip-actions';

        const known = doc.createElement('button');
        known.type = 'button';
        known.textContent = '认识';
        known.setAttribute('aria-label', `标记 ${entry.word} 为认识`);
        known.onclick = actionWithFocusRestore(onKnown);
        primaryAction = known;
        actions.append(known);

        const moreButton = doc.createElement('button');
        moreButton.type = 'button';
        moreButton.textContent = '更多';
        moreButton.dataset.qianciTooltipMore = 'true';
        moreButton.setAttribute('aria-expanded', 'false');
        moreButton.setAttribute('aria-label', `更多关于 ${entry.word} 的操作`);
        actions.append(moreButton);
        actions.append(createCloseButton());

        header.append(actions);
        card.append(header);

        appendTextLine(shadowRoot, card, entry.phonetic, 'qianci-tooltip-phonetic');
        appendTextLine(shadowRoot, card, compactTranslation(entry.translation), 'qianci-tooltip-translation');

        const morePanel = doc.createElement('div');
        morePanel.className = 'qianci-more-panel';
        morePanel.hidden = true;
        morePanel.dataset.qianciMorePanel = 'true';

        const alwaysAnnotate = doc.createElement('button');
        alwaysAnnotate.type = 'button';
        alwaysAnnotate.textContent = '总是提醒';
        alwaysAnnotate.setAttribute('aria-label', `总是提醒 ${entry.word}`);
        alwaysAnnotate.onclick = actionWithFocusRestore(onAlwaysAnnotate);
        morePanel.append(alwaysAnnotate);

        if (options.onTranslationFeedback) {
          const feedbackButton = doc.createElement('button');
          feedbackButton.type = 'button';
          feedbackButton.className = 'qianci-feedback-link';
          feedbackButton.dataset.qianciTranslationFeedback = 'true';
          feedbackButton.textContent = '改释义';
          feedbackButton.setAttribute('aria-label', `修改 ${entry.word} 的释义`);
          feedbackButton.onclick = () => {
            showInlineTranslationEditor(anchor, entry, options.onTranslationFeedback!);
            reposition(anchor);
          };
          morePanel.append(feedbackButton);
        }

        appendEntryMeta(morePanel, entry, undefined, anchor);
        card.append(morePanel);

        moreButton.onclick = () => {
          const open = morePanel.hidden;
          morePanel.hidden = !open;
          moreButton.setAttribute('aria-expanded', String(open));
          moreButton.textContent = open ? '收起' : '更多';
          cancelHide();
          reposition(anchor);
        };
      });

      if (options.focusPrimaryAction) {
        primaryAction?.focus();
      }
    },
    showMissing(anchor, word, onLookup, message = '词库里没有', options = {}) {
      let primaryAction: HTMLButtonElement | undefined;
      returnFocusTarget = options.returnFocusTo;
      const allowOnlineLookup = options.showOnlineLookup !== false;
      render(anchor, `潜词查词卡片：${word}`, false, (card) => {
        const header = doc.createElement('div');
        header.className = 'qianci-tooltip-header';

        const label = doc.createElement('strong');
        label.textContent = word;
        header.append(label);

        const actions = doc.createElement('div');
        actions.className = 'qianci-tooltip-actions';

        if (allowOnlineLookup) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.textContent = '联网查询';
          button.setAttribute('aria-label', `联网查询 ${word}`);
          button.onclick = () => {
            void onLookup();
          };
          primaryAction = button;
          actions.append(button);
        }

        const closeButton = createCloseButton();
        if (!primaryAction) {
          primaryAction = closeButton;
        }
        actions.append(closeButton);
        header.append(actions);
        card.append(header);

        appendTextLine(
          shadowRoot,
          card,
          allowOnlineLookup ? message : message || '本地没有这个词，且已关闭联网补查',
          'qianci-tooltip-translation',
          options.announceStatus ? { role: 'status', ariaLive: 'polite' } : {}
        );
      });

      if (options.focusPrimaryAction) {
        primaryAction?.focus();
      }
    },
    showLoading(anchor, word, options = {}) {
      let primaryAction: HTMLButtonElement | undefined;
      returnFocusTarget = options.returnFocusTo;
      render(anchor, `潜词查词卡片：${word}`, true, (card) => {
        const header = doc.createElement('div');
        header.className = 'qianci-tooltip-header';

        const label = doc.createElement('strong');
        label.textContent = word;
        header.append(label);

        const actions = doc.createElement('div');
        actions.className = 'qianci-tooltip-actions';
        primaryAction = createCloseButton();
        actions.append(primaryAction);
        header.append(actions);
        card.append(header);

        const line = doc.createElement('div');
        line.setAttribute('role', 'status');
        line.setAttribute('aria-live', 'polite');
        line.textContent = `${word} 本地词库未收录，正在联网…`;
        card.append(line);
      });

      if (options.focusPrimaryAction) {
        primaryAction?.focus();
      }
    },
    showKnownNotice(anchor, word, onUndo) {
      render(anchor, `潜词操作提示：${word}`, false, (card) => {
        const header = doc.createElement('div');
        header.className = 'qianci-tooltip-header';

        const label = doc.createElement('strong');
        label.textContent = '已标为认识';
        header.append(label);

        const actions = doc.createElement('div');
        actions.className = 'qianci-tooltip-actions';

        const undoButton = doc.createElement('button');
        undoButton.type = 'button';
        undoButton.textContent = '撤销';
        undoButton.setAttribute('aria-label', `撤销标记 ${word} 为认识`);
        undoButton.onclick = () => {
          onUndo();
        };
        actions.append(undoButton);
        actions.append(createCloseButton());

        header.append(actions);
        card.append(header);
        appendTextLine(shadowRoot, card, `${word} 暂时不会再被标注。`, 'qianci-tooltip-translation', {
          role: 'status',
          ariaLive: 'polite'
        });
      });
    },
    showAlwaysAnnotateNotice(anchor, word, onUndo) {
      render(anchor, `潜词操作提示：${word}`, false, (card) => {
        const header = doc.createElement('div');
        header.className = 'qianci-tooltip-header';

        const label = doc.createElement('strong');
        label.textContent = '已设为总是提醒';
        header.append(label);

        const actions = doc.createElement('div');
        actions.className = 'qianci-tooltip-actions';

        const undoButton = doc.createElement('button');
        undoButton.type = 'button';
        undoButton.textContent = '撤销';
        undoButton.setAttribute('aria-label', `撤销总是提醒 ${word}`);
        undoButton.onclick = () => {
          onUndo();
        };
        actions.append(undoButton);
        actions.append(createCloseButton());

        header.append(actions);
        card.append(header);
        appendTextLine(shadowRoot, card, `${word} 之后会优先保持标注，不会被路过收起。`, 'qianci-tooltip-translation', {
          role: 'status',
          ariaLive: 'polite'
        });
      });
    },
    cancelHide,
    scheduleHide,
    ownsEventTarget,
    hide: hideNow,
    version() {
      return displayVersion;
    },
    updateFocusColor(color) {
      tooltipHost.style.setProperty('--qianci-focus-color', color);
    },
    dispose() {
      doc.removeEventListener('keydown', handleKeydown);
      doc.removeEventListener('pointerdown', handleOutsidePointerDown);
      tooltipHost.removeEventListener('mouseenter', handleTooltipPointerEnter);
      tooltipHost.removeEventListener('mouseleave', handleTooltipPointerLeave);
      tooltipHost.removeEventListener('focusin', handleFocusIn);
      tooltipHost.removeEventListener('focusout', handleFocusOut);
      hideNow();
      tooltipHost.remove();
    }
  };
}
