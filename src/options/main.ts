import './styles.css';
import type { UserLevel } from '../core/types';
import type { VocabItem } from '../storage/vocabStore';
import { createChromeStorageAdapter, createMemoryStore, type KeyValueStore } from '../storage/browserAdapter';
import { loadProfile, saveProfile } from '../storage/profileStore';
import { loadVocab } from '../storage/vocabStore';

export interface OptionsState {
  level: UserLevel;
  vocab: VocabItem[];
}

interface OptionsHandlers {
  onLevelChange?: (level: UserLevel) => void | Promise<void>;
  onExport?: (csv: string) => void | Promise<void>;
  onForgetWord?: (word: string) => void | Promise<void>;
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
      <tr><th>Word</th><th>Meaning</th><th>Seen</th></tr>
    </thead>
  `;
  const body = document.createElement('tbody');
  for (const item of state.vocab) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${item.word}</strong></td>
      <td>${item.translation}</td>
      <td>${new Date(item.lastSeenAt).toLocaleDateString()}</td>
    `;
    body.append(row);
  }
  table.append(body);
  vocabPanel.append(table);
  shell.append(vocabPanel);

  root.append(shell);
}

function createDefaultStore(): KeyValueStore {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return createChromeStorageAdapter(chrome.storage.local);
  }
  return createMemoryStore();
}

export async function mountOptionsApp(root: HTMLElement, store = createDefaultStore()): Promise<void> {
  const profile = (await loadProfile(store)) ?? { level: 'cet4', levelScore: 2.6, words: {} };
  const vocab = await loadVocab(store);

  renderOptions(root, {
    level: profile.level,
    vocab
  }, {
    onLevelChange: async (level) => {
      await saveProfile(store, { ...profile, level });
    },
    onExport: async (csv) => {
      downloadCsv(csv);
    }
  });
}

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  void mountOptionsApp(app);
}
