import { describe, expect, it, vi } from 'vitest';
import {
  LOOKUP_SELECTION_MENU_ID,
  LOOKUP_SELECTION_MESSAGE_TYPE,
  ONLINE_LOOKUP_MESSAGE_TYPE,
  registerBackground
} from '../../src/background/worker';

describe('background worker', () => {
  it('opens options and wires selection context-menu lookup', () => {
    const installedListeners: Array<() => void> = [];
    const actionListeners: Array<() => void> = [];
    const contextMenuListeners: Array<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void> = [];
    const messageListeners: Array<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    > = [];
    const lookupOnline = vi.fn(async () => ({ ok: true, message: '已同步到词库', entry: { word: 'serendipity' } }));

    const chromeMock = {
      runtime: {
        onInstalled: {
          addListener(listener: () => void) {
            installedListeners.push(listener);
          }
        },
        onMessage: {
          addListener(
            listener: (
              message: unknown,
              sender: chrome.runtime.MessageSender,
              sendResponse: (response: unknown) => void
            ) => boolean | void
          ) {
            messageListeners.push(listener);
          }
        },
        openOptionsPage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn()
        }
      },
      action: {
        onClicked: {
          addListener(listener: () => void) {
            actionListeners.push(listener);
          }
        }
      },
      contextMenus: {
        removeAll: vi.fn((callback?: () => void) => callback?.()),
        create: vi.fn(),
        onClicked: {
          addListener(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) {
            contextMenuListeners.push(listener);
          }
        }
      },
      tabs: {
        sendMessage: vi.fn()
      }
    };

    registerBackground(chromeMock as never, { lookupOnline });

    installedListeners[0]();
    expect(chromeMock.storage.local.get).toHaveBeenCalledWith(['qianci.profile']);
    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LOOKUP_SELECTION_MENU_ID,
        contexts: ['selection']
      })
    );

    actionListeners[0]();
    expect(chromeMock.runtime.openOptionsPage).toHaveBeenCalled();

    contextMenuListeners[0](
      {
        menuItemId: LOOKUP_SELECTION_MENU_ID,
        selectionText: 'serendipity'
      } as chrome.contextMenus.OnClickData,
      { id: 9 } as chrome.tabs.Tab
    );

    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(9, {
      type: LOOKUP_SELECTION_MESSAGE_TYPE,
      text: 'serendipity'
    });

    const sendResponse = vi.fn();
    const keepAlive = messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'serendipity' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(keepAlive).toBe(true);
    return Promise.resolve().then(() => {
      expect(lookupOnline).toHaveBeenCalledWith('serendipity');
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, message: '已同步到词库', entry: expect.objectContaining({ word: 'serendipity' }) })
      );
    });
  });
});
