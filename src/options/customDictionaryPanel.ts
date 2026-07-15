import type { DictionaryEntry } from '../core/dictionaryEntry';
import type { CustomDictionary } from '../storage/customDictionaryStore';

export interface CustomDictionaryPanelState {
  entries: DictionaryEntry[];
  draftWord?: string;
  draftTranslation?: string;
  editingWord?: string;
}

export interface CustomDictionaryPanelHandlers {
  onDraftWordChange?: (word: string) => void;
  onDraftTranslationChange?: (translation: string) => void;
  onSaveCustomEntry?: (word: string, translation: string) => void | Promise<void>;
  onDeleteCustomEntry?: (word: string) => void | Promise<void>;
  onStartEditCustomEntry?: (word: string) => void | Promise<void>;
}

/**
 * 只保留用户自定义词条，排除联网缓存。
 *
 * @param dictionary 自定义词典存储内容。
 * @returns 用户自定义词条列表，按单词排序。
 */
export function listUserCustomEntries(dictionary: CustomDictionary): DictionaryEntry[] {
  return Object.values(dictionary)
    .filter((entry) => entry.source === 'custom')
    .sort((left, right) => left.word.localeCompare(right.word));
}

/**
 * 规范化自定义词条输入。
 *
 * @param word 原始单词。
 * @param translation 原始释义。
 * @returns 规范化结果；无效时返回错误文案。
 */
export function normalizeCustomEntryInput(
  word: string,
  translation: string
): { word: string; translation: string } | { error: string } {
  const normalizedWord = word.trim().toLowerCase();
  const normalizedTranslation = translation.trim().replace(/\s+/g, ' ');
  if (!/^[a-z]+(?:['’][a-z]+)?$/.test(normalizedWord.replace(/’/g, "'"))) {
    return { error: '请输入一个英文单词' };
  }
  if (!normalizedTranslation) {
    return { error: '请填写中文释义' };
  }
  return {
    word: normalizedWord.replace(/’/g, "'"),
    translation: normalizedTranslation
  };
}

/**
 * 渲染自定义释义面板，支持新增、编辑和删除。
 *
 * @param state 面板状态。
 * @param handlers 事件回调。
 * @returns 面板元素。
 */
export function createCustomDictionaryPanel(
  state: CustomDictionaryPanelState,
  handlers: CustomDictionaryPanelHandlers = {}
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel custom-dictionary-panel';
  panel.id = 'custom-dictionary';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '自定义释义';
  panel.append(title);

  const copy = document.createElement('p');
  copy.className = 'panel-copy';
  copy.textContent = '自定义释义优先于本地词库和联网结果。页面里点“释义不准”后，也会把词放到这里方便修改。';
  panel.append(copy);

  const form = document.createElement('form');
  form.className = 'custom-dictionary-form';
  form.dataset.qianciCustomDictionaryForm = 'true';

  const wordInput = document.createElement('input');
  wordInput.type = 'text';
  wordInput.className = 'search-input';
  wordInput.dataset.qianciCustomWord = 'true';
  wordInput.placeholder = '英文单词';
  wordInput.value = state.draftWord ?? '';
  wordInput.setAttribute('aria-label', '自定义单词');
  wordInput.addEventListener('input', () => {
    void handlers.onDraftWordChange?.(wordInput.value);
  });

  const translationInput = document.createElement('input');
  translationInput.type = 'text';
  translationInput.className = 'search-input';
  translationInput.dataset.qianciCustomTranslation = 'true';
  translationInput.placeholder = '中文释义';
  translationInput.value = state.draftTranslation ?? '';
  translationInput.setAttribute('aria-label', '自定义中文释义');
  translationInput.addEventListener('input', () => {
    void handlers.onDraftTranslationChange?.(translationInput.value);
  });

  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'row-action-button';
  saveButton.dataset.qianciSaveCustomEntry = 'true';
  saveButton.textContent = state.editingWord ? '保存修改' : '添加释义';

  form.append(wordInput, translationInput, saveButton);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handlers.onSaveCustomEntry?.(wordInput.value, translationInput.value);
  });
  panel.append(form);

  if (!state.entries.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-copy';
    empty.textContent = '还没有自定义释义。';
    panel.append(empty);
    return panel;
  }

  const list = document.createElement('div');
  list.className = 'custom-dictionary-list';
  for (const entry of state.entries) {
    const row = document.createElement('div');
    row.className = 'custom-dictionary-row';
    row.dataset.qianciCustomEntry = entry.word;

    const text = document.createElement('div');
    text.className = 'custom-dictionary-text';
    const word = document.createElement('strong');
    word.textContent = entry.word;
    const translation = document.createElement('span');
    translation.textContent = entry.translation;
    text.append(word, translation);

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'row-action-button';
    editButton.dataset.qianciEditCustomEntry = entry.word;
    editButton.textContent = '编辑';
    editButton.addEventListener('click', () => {
      void handlers.onStartEditCustomEntry?.(entry.word);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'row-action-button';
    deleteButton.dataset.qianciDeleteCustomEntry = entry.word;
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      void handlers.onDeleteCustomEntry?.(entry.word);
    });

    actions.append(editButton, deleteButton);
    row.append(text, actions);
    list.append(row);
  }
  panel.append(list);
  return panel;
}
