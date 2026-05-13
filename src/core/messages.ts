import type { DictionaryEntry } from './dictionaryEntry';

export const LOOKUP_SELECTION_MESSAGE_TYPE = 'qianci.lookup-selection';
export const ONLINE_LOOKUP_MESSAGE_TYPE = 'qianci.online-lookup';

export interface LookupSelectionMessage {
  type: typeof LOOKUP_SELECTION_MESSAGE_TYPE;
  text: string;
}

export interface OnlineLookupMessage {
  type: typeof ONLINE_LOOKUP_MESSAGE_TYPE;
  word: string;
}

export interface OnlineLookupResult {
  ok: boolean;
  message: string;
  entry?: DictionaryEntry;
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
