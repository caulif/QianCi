import { describe, expect, it, vi } from 'vitest';
import {
  ONLINE_LOOKUP_RETRY_ALARM_NAME,
  LOOKUP_SELECTION_MENU_ID,
  LOOKUP_SELECTION_MESSAGE_TYPE,
  ONLINE_LOOKUP_MESSAGE_TYPE,
  registerBackground
} from '../../src/background/worker';

describe('background worker', () => {
  async function flushBackgroundTasks(): Promise<void> {
    // 联网查词会先读 profile 再读写重试队列，需要多冲几次微任务。
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await Promise.resolve();
    }
  }

  function createChromeMock() {
    const installedListeners: Array<() => void> = [];
    const startupListeners: Array<() => void> = [];
    const actionListeners: Array<() => void> = [];
    const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void> = [];
    const contextMenuListeners: Array<(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void> = [];
    const messageListeners: Array<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void
    > = [];
    const storageState: Record<string, unknown> = {};

    const chromeMock = {
      runtime: {
        onInstalled: {
          addListener(listener: () => void) {
            installedListeners.push(listener);
          }
        },
        onStartup: {
          addListener(listener: () => void) {
            startupListeners.push(listener);
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
          get: vi.fn((keys: string[], callback?: (items: Record<string, unknown>) => void) => {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              if (key in storageState) {
                result[key] = storageState[key];
              }
            }
            callback?.(result);
          }),
          set: vi.fn((values: Record<string, unknown>, callback?: () => void) => {
            Object.assign(storageState, values);
            callback?.();
          }),
          remove: vi.fn((keys: string[], callback?: () => void) => {
            for (const key of keys) {
              delete storageState[key];
            }
            callback?.();
          }),
          clear: vi.fn((callback?: () => void) => {
            for (const key of Object.keys(storageState)) {
              delete storageState[key];
            }
            callback?.();
          })
        }
      },
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
        onAlarm: {
          addListener(listener: (alarm: chrome.alarms.Alarm) => void) {
            alarmListeners.push(listener);
          }
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

    return {
      chromeMock,
      storageState,
      installedListeners,
      startupListeners,
      actionListeners,
      alarmListeners,
      contextMenuListeners,
      messageListeners
    };
  }

  it('opens options and wires selection context-menu lookup', () => {
    const { chromeMock, installedListeners, actionListeners, contextMenuListeners, messageListeners } = createChromeMock();
    const lookupOnline = vi.fn(async () => ({
      ok: true,
      message: '已同步到词库',
      entry: { word: 'serendipity', phonetic: '', translation: '意外发现', rank: 999999 }
    }));

    registerBackground(chromeMock as never, { lookupOnline });

    installedListeners[0]();
    expect(chromeMock.storage.local.get).toHaveBeenCalledWith(['qianci.profile']);
    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: LOOKUP_SELECTION_MENU_ID,
        title: '用潜词查词',
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
    return flushBackgroundTasks().then(() => {
      expect(lookupOnline).toHaveBeenCalledWith('serendipity');
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, message: '已同步到词库', entry: expect.objectContaining({ word: 'serendipity' }) })
      );
    });
  });

  it('blocks online lookup when the user disabled networked enrichment', async () => {
    const { chromeMock, storageState, messageListeners } = createChromeMock();
    storageState['qianci.profile'] = {
      level: 'cet4',
      levelScore: 2.6,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      annotationDensity: 1,
      offlineDictionaryTier: 'extended',
      onlineLookupEnabled: false,
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      words: {}
    };
    const lookupOnline = vi.fn(async () => ({
      ok: true,
      message: 'should not run',
      entry: { word: 'blocked', phonetic: '', translation: '被拦截', rank: 1 }
    }));

    registerBackground(chromeMock as never, { lookupOnline });

    const sendResponse = vi.fn();
    messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'blocked' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    await flushBackgroundTasks();
    expect(lookupOnline).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        message: '已关闭联网补查',
        errorKind: 'service_unavailable'
      })
    );
  });

  it('passes online lookup error kinds back to the sender', () => {
    const { chromeMock, messageListeners } = createChromeMock();
    const lookupOnline = vi.fn(async () => ({
      ok: false,
      message: '在线词典请求过于频繁，请稍后再试',
      errorKind: 'rate_limited' as const
    }));

    registerBackground(chromeMock as never, { lookupOnline });

    const sendResponse = vi.fn();
    const keepAlive = messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'limited' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );

    expect(keepAlive).toBe(true);
    return flushBackgroundTasks().then(() => {
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          errorKind: 'rate_limited'
        })
      );
    });
  });

  it('queues retryable online lookup failures and schedules an alarm', async () => {
    const { chromeMock, messageListeners, storageState } = createChromeMock();
    const lookupOnline = vi.fn(async () => ({
      ok: false,
      message: '联网查询失败',
      errorKind: 'network_error' as const
    }));

    registerBackground(chromeMock as never, { lookupOnline, now: () => 1_000 });

    const sendResponse = vi.fn();
    messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'Serendipity' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    await flushBackgroundTasks();

    expect(storageState['qianci.onlineLookupQueue']).toEqual(
      expect.objectContaining({
        serendipity: expect.objectContaining({ attempts: 1, lastErrorKind: 'network_error' })
      })
    );
    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      ONLINE_LOOKUP_RETRY_ALARM_NAME,
      expect.objectContaining({ when: expect.any(Number) })
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        queued: true,
        message: expect.stringContaining('已加入重试，可稍后在弹窗查看')
      })
    );
  });

  it('retries due queued lookups from alarms and removes successful items', async () => {
    const { chromeMock, alarmListeners, storageState } = createChromeMock();
    storageState['qianci.onlineLookupQueue'] = {
      serendipity: {
        word: 'serendipity',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 1_000,
        nextRetryAt: 1_500
      }
    };
    storageState['qianci.profile'] = {
      level: 'cet4',
      levelScore: 2.6,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      annotationDensity: 1,
      offlineDictionaryTier: 'extended',
      onlineLookupEnabled: true,
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      words: {}
    };
    const lookupOnline = vi.fn(async () => ({
      ok: true,
      message: '已同步到词库',
      entry: { word: 'serendipity', phonetic: '', translation: '意外发现', rank: 999999, source: 'online' as const }
    }));

    registerBackground(chromeMock as never, { lookupOnline, now: () => 2_000 });

    alarmListeners[0]({ name: ONLINE_LOOKUP_RETRY_ALARM_NAME } as chrome.alarms.Alarm);
    await flushBackgroundTasks();

    expect(lookupOnline).toHaveBeenCalledWith('serendipity');
    expect(storageState['qianci.onlineLookupQueue']).toEqual({});
    expect(storageState['qianci.customDictionary']).toEqual(
      expect.objectContaining({
        serendipity: expect.objectContaining({
          translation: '意外发现',
          source: 'online'
        })
      })
    );
    expect(storageState['qianci.profile']).toEqual(
      expect.objectContaining({
        words: expect.objectContaining({
          serendipity: expect.objectContaining({ isUnknown: true, isKnown: false })
        })
      })
    );
    expect(storageState['qianci.vocab']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: 'serendipity', translation: '意外发现' })
      ])
    );
  });

  it('persists online lookup hits into local dictionary as unknown by default', async () => {
    const { chromeMock, messageListeners, storageState } = createChromeMock();
    storageState['qianci.profile'] = {
      level: 'cet4',
      levelScore: 2.6,
      underlineTone: 'graphite',
      lookupTrigger: 'hover',
      manualShortcut: 'alt',
      annotationDensity: 1,
      offlineDictionaryTier: 'extended',
      onlineLookupEnabled: true,
      feedbackSettings: {
        skipLimit: 3,
        skipDelayMs: 3500,
        decayHalfLifeDays: 30,
        suppressionMode: 'balanced'
      },
      words: {}
    };
    const lookupOnline = vi.fn(async () => ({
      ok: true,
      message: '已同步到词库',
      entry: {
        word: 'ephemeral',
        phonetic: '',
        translation: '短暂的',
        rank: 999999,
        source: 'online' as const
      }
    }));

    registerBackground(chromeMock as never, { lookupOnline, now: () => 5_000 });

    const sendResponse = vi.fn();
    messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'Ephemeral' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    await flushBackgroundTasks();

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(storageState['qianci.customDictionary']).toEqual(
      expect.objectContaining({
        ephemeral: expect.objectContaining({ translation: '短暂的', source: 'online' })
      })
    );
    expect(storageState['qianci.profile']).toEqual(
      expect.objectContaining({
        words: expect.objectContaining({
          ephemeral: expect.objectContaining({ isUnknown: true })
        })
      })
    );
  });

  it('recreates retry alarm from persisted queue on startup', async () => {
    const { chromeMock, startupListeners, storageState } = createChromeMock();
    storageState['qianci.onlineLookupQueue'] = {
      serendipity: {
        word: 'serendipity',
        attempts: 1,
        lastErrorKind: 'network_error',
        lastTriedAt: 1_000,
        nextRetryAt: 3_000
      }
    };

    registerBackground(chromeMock as never, { lookupOnline: vi.fn(), now: () => 2_000 });

    startupListeners[0]();
    await flushBackgroundTasks();

    expect(chromeMock.alarms.create).toHaveBeenCalledWith(
      ONLINE_LOOKUP_RETRY_ALARM_NAME,
      expect.objectContaining({ when: 3_000 })
    );
  });

  it('responds with network error and queues retry when lookup throws', async () => {
    const { chromeMock, messageListeners, storageState } = createChromeMock();
    const lookupOnline = vi.fn(async () => {
      throw new Error('boom');
    });

    registerBackground(chromeMock as never, { lookupOnline, now: () => 1_000 });

    const sendResponse = vi.fn();
    messageListeners[0](
      { type: ONLINE_LOOKUP_MESSAGE_TYPE, word: 'serendipity' },
      {} as chrome.runtime.MessageSender,
      sendResponse
    );
    await flushBackgroundTasks();

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        errorKind: 'network_error',
        queued: true
      })
    );
    expect(storageState['qianci.onlineLookupQueue']).toEqual(
      expect.objectContaining({
        serendipity: expect.objectContaining({ attempts: 1 })
      })
    );
  });
});
