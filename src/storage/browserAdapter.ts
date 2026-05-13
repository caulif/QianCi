export interface KeyValueStore {
  get<T = Record<string, unknown>>(keys: string[]): Promise<T>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const state: Record<string, unknown> = { ...initial };

  const store: KeyValueStore = {
    async get<T = Record<string, unknown>>(keys: string[]): Promise<T> {
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in state) {
          result[key] = state[key];
        }
      }
      return result as T;
    },
    async set(values: Record<string, unknown>) {
      Object.assign(state, values);
    },
    async remove(keys: string[]) {
      for (const key of keys) {
        delete state[key];
      }
    },
    async clear() {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
    }
  };

  return store;
}

export function createChromeStorageAdapter(area: chrome.storage.StorageArea): KeyValueStore {
  const store: KeyValueStore = {
    get<T = Record<string, unknown>>(keys: string[]): Promise<T> {
      return new Promise<T>((resolve) => {
        area.get(keys, (items) => resolve(items as T));
      });
    },
    set(values: Record<string, unknown>) {
      return new Promise<void>((resolve) => {
        area.set(values, () => resolve());
      });
    },
    remove(keys: string[]) {
      return new Promise<void>((resolve) => {
        area.remove(keys, () => resolve());
      });
    },
    clear() {
      return new Promise<void>((resolve) => {
        area.clear(() => resolve());
      });
    }
  };

  return store;
}
