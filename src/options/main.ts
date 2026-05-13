import './styles.css';
import { createProfile, LOOKUP_TRIGGERS, MANUAL_SHORTCUTS, UNDERLINE_TONES } from '../core/profile';
import type { LookupTrigger, ManualShortcut, UnderlineTone, UserLevel } from '../core/types';
import type { VocabItem } from '../storage/vocabStore';
import { createChromeStorageAdapter, createMemoryStore, type KeyValueStore } from '../storage/browserAdapter';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { loadVocab, removeVocabItem, saveVocab } from '../storage/vocabStore';

export interface OptionsState {
  level: UserLevel;
  underlineTone: UnderlineTone;
  lookupTrigger: LookupTrigger;
  manualShortcut: ManualShortcut;
  vocab: VocabItem[];
  knownWords: Array<{ word: string; lastSeenAt: number }>;
  searchQuery?: string;
}

interface OptionsHandlers {
  onLevelChange?: (level: UserLevel) => void | Promise<void>;
  onToneChange?: (tone: UnderlineTone) => void | Promise<void>;
  onLookupTriggerChange?: (trigger: LookupTrigger) => void | Promise<void>;
  onManualShortcutChange?: (shortcut: ManualShortcut) => void | Promise<void>;
  onSearchChange?: (query: string) => void | Promise<void>;
  onRemoveVocab?: (word: string) => void | Promise<void>;
  onForgetKnown?: (word: string) => void | Promise<void>;
  onExport?: (csv: string) => void | Promise<void>;
}

const LEVELS: Array<{ level: UserLevel; label: string }> = [
  { level: 'starter', label: '入门' },
  { level: 'cet4', label: '四级' },
  { level: 'cet6', label: '六级' },
  { level: 'graduate', label: '考研' },
  { level: 'ielts-toefl', label: '雅思托福' },
  { level: 'professional', label: '专业阅读' }
];

export function levelLabel(level: UserLevel): string {
  return LEVELS.find((item) => item.level === level)?.label ?? '四级';
}

function levelIndex(level: UserLevel): number {
  return Math.max(0, LEVELS.findIndex((item) => item.level === level));
}

function levelFromIndex(index: number): UserLevel {
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, index))].level;
}

export function buildVocabCsv(vocab: VocabItem[]): string {
  const rows = ['word,translation,lastSeenAt,lookupCount'];
  for (const item of vocab) {
    rows.push([item.word, item.translation, String(item.lastSeenAt), String(item.lookupCount)].map(escapeCsv).join(','));
  }
  return rows.join('\n');
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qianci-vocab-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function renderOptions(root: HTMLElement, state: OptionsState, handlers: OptionsHandlers = {}): void {
  root.innerHTML = '';
  const searchQuery = state.searchQuery?.trim().toLowerCase() ?? '';
  const matchesQuery = (word: string, translation = '') =>
    !searchQuery || `${word} ${translation}`.toLowerCase().includes(searchQuery);
  const filteredVocab = state.vocab.filter((item) => matchesQuery(item.word, item.translation));
  const filteredKnownWords = state.knownWords.filter((item) => matchesQuery(item.word));

  const shell = document.createElement('section');
  shell.className = 'options-shell';

  const header = document.createElement('header');
  header.className = 'options-header';
  header.innerHTML = `
    <div>
      <h1>潜词</h1>
      <p>安静标出生词，越用越懂你</p>
    </div>
  `;
  shell.append(header);

  const searchPanel = document.createElement('section');
  searchPanel.className = 'panel';
  const searchTitle = document.createElement('div');
  searchTitle.className = 'panel-title';
  searchTitle.textContent = '词表检索';
  searchPanel.append(searchTitle);

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'search-input';
  searchInput.placeholder = '搜单词或释义';
  searchInput.value = state.searchQuery ?? '';
  searchInput.setAttribute('aria-label', '搜索词表');
  searchInput.addEventListener('input', () => {
    void handlers.onSearchChange?.(searchInput.value);
  });
  searchPanel.append(searchInput);
  shell.append(searchPanel);

  const levelPanel = document.createElement('section');
  levelPanel.className = 'panel';
  const levelTitle = document.createElement('div');
  levelTitle.className = 'panel-title';
  levelTitle.textContent = '初始词汇水位线';
  levelPanel.append(levelTitle);

  const levelRow = document.createElement('div');
  levelRow.className = 'level-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(LEVELS.length - 1);
  slider.step = '1';
  slider.value = String(levelIndex(state.level));

  const badge = document.createElement('span');
  badge.className = 'level-badge';
  badge.textContent = levelLabel(state.level);

  slider.addEventListener('input', () => {
    const nextLevel = levelFromIndex(Number(slider.value));
    badge.textContent = levelLabel(nextLevel);
    void handlers.onLevelChange?.(nextLevel);
  });

  levelRow.append(slider, badge);
  levelPanel.append(levelRow);
  shell.append(levelPanel);

  const triggerPanel = document.createElement('section');
  triggerPanel.className = 'panel';
  const triggerTitle = document.createElement('div');
  triggerTitle.className = 'panel-title';
  triggerTitle.textContent = '触发方式';
  triggerPanel.append(triggerTitle);

  const triggerRow = document.createElement('div');
  triggerRow.className = 'choice-row';

  for (const item of LOOKUP_TRIGGERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.dataset.qianciLookupTrigger = item.trigger;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(state.lookupTrigger === item.trigger));
    button.addEventListener('click', () => {
      void handlers.onLookupTriggerChange?.(item.trigger);
    });
    triggerRow.append(button);
  }

  triggerPanel.append(triggerRow);
  shell.append(triggerPanel);

  const tonePanel = document.createElement('section');
  tonePanel.className = 'panel';
  const toneTitle = document.createElement('div');
  toneTitle.className = 'panel-title';
  toneTitle.textContent = '划线颜色';
  tonePanel.append(toneTitle);

  const toneRow = document.createElement('div');
  toneRow.className = 'tone-row';

  for (const tone of UNDERLINE_TONES) {
    const toneButton = document.createElement('button');
    toneButton.type = 'button';
    toneButton.className = 'tone-button';
    toneButton.dataset.qianciTone = tone.tone;
    toneButton.title = tone.label;
    toneButton.setAttribute('aria-label', tone.label);
    toneButton.setAttribute('aria-pressed', String(state.underlineTone === tone.tone));
    if (state.underlineTone === tone.tone) {
      toneButton.dataset.selected = 'true';
    }

    const swatch = document.createElement('span');
    swatch.className = 'tone-swatch';
    swatch.style.background = tone.color;
    toneButton.append(swatch);

    const label = document.createElement('span');
    label.className = 'tone-label';
    label.textContent = tone.label;
    toneButton.append(label);

    toneButton.addEventListener('click', () => {
      void handlers.onToneChange?.(tone.tone);
    });

    toneRow.append(toneButton);
  }

  tonePanel.append(toneRow);
  shell.append(tonePanel);

  const manualPanel = document.createElement('section');
  manualPanel.className = 'panel';
  const manualTitle = document.createElement('div');
  manualTitle.className = 'panel-title';
  manualTitle.textContent = '手动查词快捷键';
  manualPanel.append(manualTitle);

  const shortcutRow = document.createElement('div');
  shortcutRow.className = 'choice-row';

  for (const item of MANUAL_SHORTCUTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.dataset.qianciManualShortcut = item.key;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(state.manualShortcut === item.key));
    button.addEventListener('click', () => {
      void handlers.onManualShortcutChange?.(item.key);
    });
    shortcutRow.append(button);
  }

  manualPanel.append(shortcutRow);
  shell.append(manualPanel);

  const vocabPanel = document.createElement('section');
  vocabPanel.className = 'panel';
  const vocabHeader = document.createElement('div');
  vocabHeader.className = 'panel-toolbar';

  const vocabTitle = document.createElement('div');
  vocabTitle.className = 'panel-title';
  vocabTitle.textContent = '生词';
  vocabHeader.append(vocabTitle);

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'icon-button';
  exportButton.title = '导出 CSV';
  exportButton.textContent = '⇩';
  exportButton.addEventListener('click', () => {
    const csv = buildVocabCsv(state.vocab);
    if (handlers.onExport) {
      void handlers.onExport(csv);
      return;
    }
    downloadCsv(csv);
  });
  vocabHeader.append(exportButton);
  vocabPanel.append(vocabHeader);

  const table = document.createElement('table');
  table.className = 'vocab-table';
  table.innerHTML = `
    <thead>
      <tr><th>Word</th><th>Meaning</th><th>Seen</th><th></th></tr>
    </thead>
  `;
  const body = document.createElement('tbody');
  if (filteredVocab.length) {
    for (const item of filteredVocab) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${item.word}</strong></td>
        <td>${item.translation}</td>
        <td>${new Date(item.lastSeenAt).toLocaleDateString()}</td>
        <td class="row-actions"></td>
      `;
      const actions = row.querySelector('.row-actions');
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'row-action-button';
      removeButton.dataset.qianciRemoveVocab = item.word;
      removeButton.textContent = '移除';
      removeButton.addEventListener('click', () => {
        void handlers.onRemoveVocab?.(item.word);
      });
      actions?.append(removeButton);
      body.append(row);
    }
  } else {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="empty-state">还没有生词</td>';
    body.append(row);
  }
  table.append(body);
  vocabPanel.append(table);
  shell.append(vocabPanel);

  const knownPanel = document.createElement('section');
  knownPanel.className = 'panel';
  const knownTitle = document.createElement('div');
  knownTitle.className = 'panel-title';
  knownTitle.textContent = '熟词';
  knownPanel.append(knownTitle);

  const knownTable = document.createElement('table');
  knownTable.className = 'vocab-table';
  knownTable.innerHTML = `
    <thead>
      <tr><th>Word</th><th>Last seen</th><th></th></tr>
    </thead>
  `;
  const knownBody = document.createElement('tbody');
  if (filteredKnownWords.length) {
    for (const item of filteredKnownWords) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${item.word}</strong></td>
        <td>${new Date(item.lastSeenAt).toLocaleDateString()}</td>
        <td class="row-actions"></td>
      `;
      const actions = row.querySelector('.row-actions');
      const forgetButton = document.createElement('button');
      forgetButton.type = 'button';
      forgetButton.className = 'row-action-button';
      forgetButton.dataset.qianciForgetKnown = item.word;
      forgetButton.textContent = '移出';
      forgetButton.addEventListener('click', () => {
        void handlers.onForgetKnown?.(item.word);
      });
      actions?.append(forgetButton);
      knownBody.append(row);
    }
  } else {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" class="empty-state">还没有熟词</td>';
    knownBody.append(row);
  }
  knownTable.append(knownBody);
  knownPanel.append(knownTable);
  shell.append(knownPanel);

  root.append(shell);
}

function createDefaultStore(): KeyValueStore {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return createChromeStorageAdapter(chrome.storage.local);
  }
  return createMemoryStore();
}

export async function mountOptionsApp(root: HTMLElement, store = createDefaultStore()): Promise<void> {
  let profile = (await loadProfile(store)) ?? createProfile('cet4');
  let vocab = await loadVocab(store);
  let searchQuery = '';

  const knownWords = () =>
    Object.entries(profile.words)
      .filter(([, state]) => state.isKnown)
      .sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)
      .map(([word, state]) => ({ word, lastSeenAt: state.lastSeenAt }));

  const render = (): void => {
    renderOptions(
      root,
      {
        level: profile.level,
        underlineTone: profile.underlineTone,
        lookupTrigger: profile.lookupTrigger,
        manualShortcut: profile.manualShortcut,
        vocab,
        knownWords: knownWords(),
        searchQuery
      },
      {
        onLevelChange: async (level) => {
          profile = { ...profile, level };
          await saveProfile(store, profile);
          render();
        },
        onToneChange: async (tone) => {
          profile = { ...profile, underlineTone: tone };
          await saveProfile(store, profile);
          render();
        },
        onLookupTriggerChange: async (trigger) => {
          profile = { ...profile, lookupTrigger: trigger };
          await saveProfile(store, profile);
          render();
        },
        onManualShortcutChange: async (shortcut) => {
          profile = { ...profile, manualShortcut: shortcut };
          await saveProfile(store, profile);
          render();
        },
        onSearchChange: async (query) => {
          searchQuery = query;
          render();
        },
        onRemoveVocab: async (word) => {
          vocab = removeVocabItem(vocab, word);
          render();
          await saveVocab(store, vocab);
        },
        onForgetKnown: async (word) => {
          const state = profile.words[word];
          if (!state) {
            return;
          }

          profile = {
            ...profile,
            words: {
              ...profile.words,
              [word]: {
                ...state,
                familiarity: 0,
                isKnown: false,
                isUnknown: false
              }
            }
          };
          render();
          await saveProfile(store, profile);
        },
        onExport: async (csv) => {
          downloadCsv(csv);
        }
      }
    );
  };

  render();
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void mountOptionsApp(app);
}
