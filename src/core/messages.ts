import type { DictionaryEntry } from './dictionaryEntry';
import type { SiteMode } from './types';

export const LOOKUP_SELECTION_MESSAGE_TYPE = 'qianci.lookup-selection';
export const ONLINE_LOOKUP_MESSAGE_TYPE = 'qianci.online-lookup';
export const PAGE_DIAGNOSTICS_MESSAGE_TYPE = 'qianci.page-diagnostics';
export const RESCAN_PAGE_MESSAGE_TYPE = 'qianci.rescan-page';

export interface LookupSelectionMessage {
  type: typeof LOOKUP_SELECTION_MESSAGE_TYPE;
  text: string;
}

export interface OnlineLookupMessage {
  type: typeof ONLINE_LOOKUP_MESSAGE_TYPE;
  word: string;
}

export interface PageDiagnosticsMessage {
  type: typeof PAGE_DIAGNOSTICS_MESSAGE_TYPE;
}

export interface RescanPageMessage {
  type: typeof RESCAN_PAGE_MESSAGE_TYPE;
}

export interface PageDiagnostics {
  siteMode: SiteMode;
  annotatedWords: number;
  scannedTextNodes: number;
  pendingScan: boolean;
  lastScanAt: number;
  lastScanDurationMs: number;
  maxScanSliceDurationMs?: number;
  queuedScanNodes?: number;
  deferredScanNodes?: number;
  throttledMutationBatches?: number;
  warnings: Array<'manual-only' | 'paused' | 'dynamic-page' | 'editor-detected' | 'form-heavy' | 'code-heavy'>;
}

export type OnlineLookupErrorKind =
  | 'not_found'
  | 'rate_limited'
  | 'service_unavailable'
  | 'network_error'
  | 'timeout'
  | 'parse_error';

export interface OnlineLookupResult {
  ok: boolean;
  message: string;
  entry?: DictionaryEntry;
  errorKind?: OnlineLookupErrorKind;
  queued?: boolean;
}

export function isLookupSelectionMessage(message: unknown): message is LookupSelectionMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as LookupSelectionMessage).type === LOOKUP_SELECTION_MESSAGE_TYPE &&
      typeof (message as LookupSelectionMessage).text === 'string'
  );
}

export function isOnlineLookupMessage(message: unknown): message is OnlineLookupMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as OnlineLookupMessage).type === ONLINE_LOOKUP_MESSAGE_TYPE &&
      typeof (message as OnlineLookupMessage).word === 'string'
  );
}

export function isPageDiagnosticsMessage(message: unknown): message is PageDiagnosticsMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as PageDiagnosticsMessage).type === PAGE_DIAGNOSTICS_MESSAGE_TYPE
  );
}

export function isRescanPageMessage(message: unknown): message is RescanPageMessage {
  return Boolean(
    message && typeof message === 'object' && (message as RescanPageMessage).type === RESCAN_PAGE_MESSAGE_TYPE
  );
}
