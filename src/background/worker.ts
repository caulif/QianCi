import { LOOKUP_SELECTION_MESSAGE_TYPE, ONLINE_LOOKUP_MESSAGE_TYPE, isOnlineLookupMessage } from '../core/messages';
import { fetchOnlineDictionaryEntry } from './onlineDictionary';

export { LOOKUP_SELECTION_MESSAGE_TYPE, ONLINE_LOOKUP_MESSAGE_TYPE };

export const LOOKUP_SELECTION_MENU_ID = 'qianci.lookup-selection';

interface BackgroundChromeApi {
  runtime: {
    onInstalled: { addListener(listener: () => void): void };
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
  lookupOnline?: (word: string) => Promise<unknown>;
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

  api.runtime.onInstalled.addListener(() => {
    void api.storage.local.get(['qianci.profile']);
    rebuildContextMenu(api);
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

    void lookupOnline(message.word).then(sendResponse);
    return true;
  });
}

if (typeof chrome !== 'undefined') {
  registerBackground(chrome as never);
}
