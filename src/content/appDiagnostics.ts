import type { PageDiagnostics } from '../core/messages';
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
}

/**
 * Builds popup diagnostics from the current content app scan state.
 *
 * @param input Current content app state needed by diagnostics.
 * @returns Page diagnostics safe to send through extension messaging.
 */
export function buildPageDiagnostics(input: ContentDiagnosticsInput): PageDiagnostics {
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
    warnings: diagnosticsWarnings(input)
  };
}

/**
 * Counts unique QianCi annotations across the document and observed shadow roots.
 *
 * @param doc Main page document.
 * @param observedRootList Extra roots observed by the content app.
 * @returns Number of unique annotation elements.
 */
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
 * Produces user-facing diagnostic warning codes for the current page state.
 *
 * @param input Current content app state needed by diagnostics.
 * @returns Warning codes consumed by popup UI and diagnostic reports.
 */
function diagnosticsWarnings(input: ContentDiagnosticsInput): PageDiagnostics['warnings'] {
  const warnings: PageDiagnostics['warnings'] = [];
  if (input.siteMode === 'paused') {
    warnings.push('paused');
  }

  if (input.siteMode === 'manual-only') {
    warnings.push('manual-only');
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
  if (editableFields.length >= 2) {
    warnings.push('form-heavy');
  }

  if (input.doc.querySelectorAll('pre').length >= 2) {
    warnings.push('code-heavy');
  }

  return warnings;
}
