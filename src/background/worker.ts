import {
  LOOKUP_SELECTION_MESSAGE_TYPE,
  ONLINE_LOOKUP_MESSAGE_TYPE,
  isOnlineLookupMessage,
  type OnlineLookupResult
} from '../core/messages';
import { createChromeStorageAdapter, type KeyValueStore } from '../storage/browserAdapter';
import {
  dueOnlineLookupItems,
  enqueueOnlineLookupRetry,
  loadOnlineLookupQueue,
  nextOnlineLookupRetryAt,
  removeOnlineLookupRetry,
  saveOnlineLookupQueue,
  shouldRetryOnlineLookupError
} from '../storage/onlineLookupQueueStore';
import { fetchOnlineDictionaryEntry } from './onlineDictionary';

export { LOOKUP_SELECTION_MESSAGE_TYPE, ONLINE_LOOKUP_MESSAGE_TYPE };

export const LOOKUP_SELECTION_MENU_ID = 'qianci.lookup-selection';
export const ONLINE_LOOKUP_RETRY_ALARM_NAME = 'qianci.online-lookup-retry';

interface BackgroundChromeApi {
  runtime: {
    onInstalled: { addListener(listener: () => void): void };
    onStartup?: { addListener(listener: () => void): void };
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: chrome.runtime.MessageSender,
          sendResponse: (response: unknown) => void
        ) => boolean | void
      ): void;
    };
    openOptionsPage(): Promise<void> | void;
  };
  storage: {
    local: {
      get(keys: string[]): Promise<unknown> | void;
      set(values: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string[], callback?: () => void): void;
      clear(callback?: () => void): void;
    };
  };
  alarms?: {
    create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): void;
    clear?(name: string): void;
    onAlarm: {
      addListener(listener: (alarm: chrome.alarms.Alarm) => void): void;
    };
  };
  action: {
    onClicked: { addListener(listener: () => void): void };
  };
  contextMenus: {
    removeAll(callback?: () => void): void;
    create(createProperties: chrome.contextMenus.CreateProperties): void;
    onClicked: {
      addListener(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
    };
  };
  tabs: {
    sendMessage(tabId: number, message: { type: string; text: string }): Promise<unknown> | void;
  };
}

interface BackgroundDependencies {
  lookupOnline?: (word: string) => Promise<OnlineLookupResult>;
  now?: () => number;
  store?: KeyValueStore;
}

function rebuildContextMenu(api: BackgroundChromeApi): void {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: LOOKUP_SELECTION_MENU_ID,
      title: '翻译所选单词',
      contexts: ['selection']
    });
  });
}

export function registerBackground(api: BackgroundChromeApi, deps: BackgroundDependencies = {}): void {
  const lookupOnline = deps.lookupOnline ?? fetchOnlineDictionaryEntry;
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createChromeStorageAdapter(api.storage.local as never);

  function scheduleNextRetry(queue: Awaited<ReturnType<typeof loadOnlineLookupQueue>>): void {
    const nextRetryAt = nextOnlineLookupRetryAt(queue);
    if (nextRetryAt !== undefined) {
      api.alarms?.create(ONLINE_LOOKUP_RETRY_ALARM_NAME, { when: nextRetryAt });
      return;
    }

    api.alarms?.clear?.(ONLINE_LOOKUP_RETRY_ALARM_NAME);
  }

  async function rememberLookupFailure(word: string, result: OnlineLookupResult): Promise<OnlineLookupResult> {
    const errorKind = result.errorKind;
    if (!shouldRetryOnlineLookupError(errorKind)) {
      return result;
    }

    const queue = await loadOnlineLookupQueue(store);
    const nextQueue = enqueueOnlineLookupRetry(queue, word, errorKind, now());
    await saveOnlineLookupQueue(store, nextQueue);
    scheduleNextRetry(nextQueue);
    return {
      ...result,
      queued: true,
      message: `${result.message}，已加入重试队列`
    };
  }

  async function handleOnlineLookup(word: string): Promise<OnlineLookupResult> {
    let result: OnlineLookupResult;
    try {
      result = await lookupOnline(word);
    } catch {
      result = {
        ok: false,
        message: '联网查询失败',
        errorKind: 'network_error'
      };
    }
    if (result.ok) {
      const queue = await loadOnlineLookupQueue(store);
      await saveOnlineLookupQueue(store, removeOnlineLookupRetry(queue, word));
      return result;
    }

    return rememberLookupFailure(word, result);
  }

  async function retryDueLookups(): Promise<void> {
    const queue = await loadOnlineLookupQueue(store);
    let nextQueue = queue;
    for (const item of dueOnlineLookupItems(queue, now())) {
      const result = await lookupOnline(item.word);
      if (result.ok) {
        nextQueue = removeOnlineLookupRetry(nextQueue, item.word);
        continue;
      }

      const errorKind = result.errorKind;
      if (shouldRetryOnlineLookupError(errorKind)) {
        nextQueue = enqueueOnlineLookupRetry(nextQueue, item.word, errorKind, now());
      } else {
        nextQueue = removeOnlineLookupRetry(nextQueue, item.word);
      }
    }

    await saveOnlineLookupQueue(store, nextQueue);
    scheduleNextRetry(nextQueue);
  }

  api.runtime.onInstalled.addListener(() => {
    void api.storage.local.get(['qianci.profile']);
    rebuildContextMenu(api);
    void loadOnlineLookupQueue(store).then(scheduleNextRetry);
  });

  api.runtime.onStartup?.addListener(() => {
    void loadOnlineLookupQueue(store).then(scheduleNextRetry);
  });

  api.action.onClicked.addListener(() => {
    void api.runtime.openOptionsPage();
  });

  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== LOOKUP_SELECTION_MENU_ID || !tab?.id || !info.selectionText) {
      return;
    }

    void api.tabs.sendMessage(tab.id, {
      type: LOOKUP_SELECTION_MESSAGE_TYPE,
      text: info.selectionText
    });
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isOnlineLookupMessage(message)) {
      return;
    }

    void handleOnlineLookup(message.word).then(sendResponse);
    return true;
  });

  api.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name !== ONLINE_LOOKUP_RETRY_ALARM_NAME) {
      return;
    }

    void retryDueLookups();
  });
}

if (typeof chrome !== 'undefined') {
  registerBackground(chrome as never);
}
