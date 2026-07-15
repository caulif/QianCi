import type { PageDiagnostics, PageTypeHint } from '../core/messages';
import type { SiteMode } from '../core/types';

export interface ContentDiagnosticsInput {
  doc: Document;
  observedRootList: ParentNode[];
  siteMode: SiteMode;
  pendingRootCount: number;
  hasPendingScan: boolean;
  scannedTextNodes: number;
  lastScanAt: number;
  lastScanDurationMs: number;
  maxScanSliceDurationMs: number;
  queuedScanNodes: number;
  deferredScanNodes: number;
  throttledMutationBatches: number;
  isTopFrame?: boolean;
}

/**
 * Builds popup diagnostics from the current content app scan state.
 */
export function buildPageDiagnostics(input: ContentDiagnosticsInput): PageDiagnostics {
  const pageType = detectPageType(input.doc);
  return {
    siteMode: input.siteMode,
    annotatedWords: annotatedWordCount(input.doc, input.observedRootList),
    scannedTextNodes: input.scannedTextNodes,
    pendingScan: input.hasPendingScan,
    lastScanAt: input.lastScanAt,
    lastScanDurationMs: input.lastScanDurationMs,
    maxScanSliceDurationMs: input.maxScanSliceDurationMs,
    queuedScanNodes: input.queuedScanNodes,
    deferredScanNodes: input.deferredScanNodes,
    throttledMutationBatches: input.throttledMutationBatches,
    pageType,
    isTopFrame: input.isTopFrame ?? true,
    warnings: diagnosticsWarnings(input, pageType)
  };
}

function annotatedWordCount(doc: Document, observedRootList: ParentNode[]): number {
  const annotatedWords = new Set<HTMLElement>();
  for (const root of [doc, ...observedRootList]) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-qianci-word]'))) {
      annotatedWords.add(element);
    }
  }
  return annotatedWords.size;
}

/**
 * 轻量页面类型识别，只用于诊断建议，不静默改模式。
 */
export function detectPageType(doc: Document): PageTypeHint {
  const hasSearchForm = Boolean(
    doc.querySelector('form[role="search"], input[type="search"], .search__form, [data-testid*="search"]')
  );
  const resultCards = doc.querySelectorAll('.result, .search-result, .g, .serp-item').length;
  if (hasSearchForm && resultCards >= 3) {
    return 'search';
  }

  const preCount = doc.querySelectorAll('pre, code, .monaco-editor, .cm-editor, .blob-code').length;
  if (preCount >= 4) {
    return 'code';
  }

  const fieldCount = doc.querySelectorAll(
    'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="password"]'
  ).length;
  if (fieldCount >= 3 || doc.querySelector('[contenteditable="true"], .monaco-editor')) {
    return 'form';
  }

  if (doc.querySelector('article, main, [role="main"]')) {
    return 'article';
  }

  if (preCount > 0 && fieldCount > 0) {
    return 'mixed';
  }

  return 'unknown';
}

function diagnosticsWarnings(
  input: ContentDiagnosticsInput,
  pageType: PageTypeHint
): PageDiagnostics['warnings'] {
  const warnings: PageDiagnostics['warnings'] = [];
  if (input.siteMode === 'paused') {
    warnings.push('paused');
  }
  if (input.siteMode === 'manual-only') {
    warnings.push('manual-only');
  }
  if (input.siteMode === 'low-density') {
    warnings.push('low-density');
  }
  if (input.siteMode === 'safe') {
    warnings.push('safe');
  }
  if (input.pendingRootCount > 10 || input.throttledMutationBatches > 0) {
    warnings.push('dynamic-page');
  }
  if (input.doc.querySelector('[contenteditable="true"], [role="textbox"], .monaco-editor, .cm-editor, .CodeMirror')) {
    warnings.push('editor-detected');
  }

  const editableFields = input.doc.querySelectorAll(
    'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"]'
  );
  if (editableFields.length >= 2 || pageType === 'form') {
    warnings.push('form-heavy');
  }
  if (input.doc.querySelectorAll('pre').length >= 2 || pageType === 'code') {
    warnings.push('code-heavy');
  }
  if (pageType === 'search') {
    warnings.push('search-page');
  }
  if (input.isTopFrame === false) {
    warnings.push('frame-context');
  }

  return warnings;
}
