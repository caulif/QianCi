# 潜词 QianCi

> A minimal browser extension for predictive English word lookup while reading.

[![License: MIT](https://img.shields.io/badge/License-MIT-111111.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563eb.svg)](https://developer.chrome.com/docs/extensions/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Vite-0f172a.svg)](./package.json)

潜词是一个极简浏览器扩展，专门服务一个场景：

**当你阅读英文网页时，它安静地标出你可能不认识的词，并在你需要时给出很短的中文释义。**

它不做整页翻译，不做学习平台，也不试图把网页变成控制台。目标一直很克制：**低打扰、低占用、越用越准。**

## Highlights

- Predictive word underlines for English web pages
- Hover or click to open a compact Chinese glossary card
- `Alt + selection` and context-menu manual lookup
- Known / unknown feedback loop that adjusts future annotation density
- Local vocab list, known-word list, and lightweight settings page
- Optional online fallback for words missing from the local dictionary

## Screenshots

| Reading view | Lookup tooltip |
| --- | --- |
| ![Reading view](./docs/screenshots/01-reading-view.png) | ![Lookup tooltip](./docs/screenshots/02-lookup-tooltip.png) |

| Settings | Vocab list |
| --- | --- |
| ![Settings panel](./docs/screenshots/03-settings-panel.png) | ![Vocab list](./docs/screenshots/04-vocab-list.png) |

## What It Does

- Pre-annotates likely unknown English words in normal article text
- Shows a small translation card with lemma, phonetic, and short Chinese meaning
- Lets users mark a word as known with one click
- Records weak positive feedback when annotated words are skipped
- Supports manual lookup for missed words
- Stores vocab progress locally in the browser
- Exposes a minimal options page for level, trigger mode, underline tone, shortcut, vocab, and known words

## Current Scope

This repository currently targets the MVP:

- Standard English web pages
- Word-level prediction and lookup
- Chrome / Edge first, Firefox compatibility reserved in architecture

Not included yet:

- Sentence translation
- PDF support
- YouTube subtitles
- OCR
- Cloud sync
- Spaced repetition review

## How It Works

### Local-first lookup

潜词优先使用本地词典与词频索引进行判断和查词，尽量保证响应快、打扰少。

### Feedback-driven annotation

用户的行为会逐步修正预判：

- 手动查词代表系统漏判
- 点击“认识”代表系统误判
- 被标注但持续跳过代表弱正反馈

这些反馈会改变未来的标注倾向，而不只是积累静态列表。

### Online fallback

当本地词典没有某个词时，用户可以手动触发联网查询。成功结果会被统一格式化后写回本地缓存和生词体系。

## Tech Stack

- TypeScript
- Vite
- Manifest V3
- Vitest
- Playwright

## Project Structure

```text
src/
  background/    background worker and online lookup bridge
  content/       page scanning, annotation, tooltip, manual lookup
  core/          decision logic, profile model, messages, types
  options/       settings page UI
  storage/       browser storage adapters and stores
  data/          generated local dictionary and rank indexes
scripts/
  build-dictionary.ts
  smoke-extension.ts
tests/
  unit/
docs/
  screenshots/
```

## Local Development

```bash
npm install
npm test
npm run build
```

Build output goes to `dist/`.

## Load the Extension

Chrome / Edge:

1. Run `npm run build`
2. Open `chrome://extensions` or `edge://extensions`
3. Enable developer mode
4. Choose "Load unpacked"
5. Select the `dist` directory

## Usage

- Predicted words:
  - Hover or click, depending on your settings
- Missed words:
  - `Alt + select a word`
  - or use the context menu item
- Wrong predictions:
  - click `认识` in the tooltip
- Settings:
  - click the extension icon

## Dictionary and Data Sources

- The bundled local dictionary is built from ECDICT-derived source data
- Runtime lookup uses generated files under `src/data/`
- Online fallback currently uses:
  - [FreeDictionaryAPI](https://freedictionaryapi.com/)
  - [MyMemory Translation API](https://mymemory.translated.net/)

## Privacy

潜词尽量把数据留在本地：

- profile, vocab, known words, and cached online entries are stored locally
- normal annotation and local lookup do not upload full page text
- only user-triggered online lookup sends the minimum text needed to third-party services

See [PRIVACY.md](./PRIVACY.md) for details.

## Testing

```bash
npm test
```

Current verification includes:

- typecheck
- unit tests
- build verification
- browser smoke test

## Roadmap Notes

The MVP is already usable, but there is still one obvious next optimization:

- shrink dictionary loading and content-script bundle size further

## License

MIT. See [LICENSE](./LICENSE).
