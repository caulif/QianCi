# 潜词 QianCi

> 一个面向中文用户的极简英文网页查词扩展。

[![License: MIT](https://img.shields.io/badge/License-MIT-111111.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563eb.svg)](https://developer.chrome.com/docs/extensions/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Vite-0f172a.svg)](./package.json)

潜词专注做好一件事：

**当你阅读英文网页时，它安静地标出你可能不认识的词，并在你需要时给出简短中文释义。**

它不做整页翻译，不做学习平台，也不试图把网页变成控制台。目标一直很克制：**低打扰、低占用、越用越准。**

## 功能亮点

- 在英文网页正文中预判并标出生词
- 悬停或点击标注词，弹出极简中文释义卡片
- 支持 `Alt + 选词` 手动查词
- 支持右键菜单查词
- 支持一键标记“认识”
- 自动记录生词与熟词
- 支持切换触发方式、划线颜色和手动查词快捷键
- 本地词库没有某个词时，可手动触发联网补查

## 截图

| 阅读页面 | 查词小窗 |
| --- | --- |
| ![阅读页面](./docs/screenshots/01-reading-view.png) | ![查词小窗](./docs/screenshots/02-lookup-tooltip.png) |

| 设置页面 | 生词列表 |
| --- | --- |
| ![设置页面](./docs/screenshots/03-settings-panel.png) | ![生词列表](./docs/screenshots/04-vocab-list.png) |

## 适合谁

如果你经常在浏览器里读这些内容，潜词会比较合适：

- 英文博客、文档、长文
- 不想被整页翻译打断阅读的人
- 想保留一点学习反馈，但不想打开复杂学习系统的人

## 它现在能做什么

- 预判英文网页正文中的可能生词，并用低干扰虚线标注
- 显示单词原型、音标和简短中文释义
- 点击“认识”后移除标注，并记入熟词
- 对标注但未触发查词的单词记录弱正反馈
- 对漏判词支持手动查词
- 在浏览器本地保存用户画像、生词、熟词和在线补查缓存
- 提供一个尽量克制的设置页

## 如何安装

Chrome / Edge：

### 方式一：直接使用 Release 安装包

1. 在 Releases 页面下载扩展安装包
2. 解压后，进入包含 `manifest.json` 的目录
3. 打开 `chrome://extensions` 或 `edge://extensions`
4. 打开开发者模式
5. 选择“加载已解压的扩展程序”
6. 选择刚才解压出来的目录

### 方式二：本地构建

1. 运行 `npm install`
2. 运行 `npm run build`
3. 打开 `chrome://extensions` 或 `edge://extensions`
4. 打开开发者模式
5. 选择“加载已解压的扩展程序”
6. 选择项目里的 `dist` 目录

### 注意

不要直接加载 GitHub 自动生成的 `Source code (zip)` 或源码仓库根目录。

那个压缩包是项目源码，不是可直接导入浏览器的构建产物；Chrome 需要的是包含 `manifest.json` 的目录。

## 如何使用

- 对已标注单词：
  - 根据设置选择悬停或点击查看释义
- 对漏判单词：
  - `Alt + 选中单词`
  - 或使用右键菜单
- 对误判单词：
  - 点击小窗里的 `认识`
- 打开设置页：
  - 点击扩展图标

## 它是怎么工作的

### 本地优先

潜词优先使用本地词典和词频索引进行判断和查词，尽量保证响应快、打扰少。

### 反馈驱动

用户行为会逐步修正预判：

- 手动查词代表系统漏判
- 点击“认识”代表系统误判
- 被标注但持续跳过代表弱正反馈

这些反馈会影响之后的标注倾向，而不只是积累静态词表。

### 联网补查

当本地词典没有某个词时，用户可以手动触发联网查询。成功结果会被统一格式化后写回本地缓存和生词体系。

## 本地开发

```bash
npm install
npm test
npm run build
```

构建产物在 `dist/`。

## 项目结构

```text
src/
  background/    后台 worker 与在线查词桥接
  content/       页面扫描、标注、tooltip、手动查词
  core/          决策逻辑、用户画像、消息、类型定义
  options/       设置页 UI
  storage/       浏览器存储适配与数据读写
  data/          生成后的本地词典与词频索引
scripts/
  build-dictionary.ts
  smoke-extension.ts
tests/
  unit/
docs/
  screenshots/
```

## 词典与数据来源

- 本地词典包基于 ECDICT 源数据构建并精简
- 运行时使用 `src/data/` 下的生成文件
- 联网补查当前使用：
  - [FreeDictionaryAPI](https://freedictionaryapi.com/)
  - [MyMemory Translation API](https://mymemory.translated.net/)

## 隐私说明

潜词尽量把数据留在本地：

- 用户画像、生词、熟词、在线补查缓存都保存在浏览器本地
- 正常标注和本地查词不会上传整页网页内容
- 只有用户主动触发联网查询时，才会向第三方服务发送最小必要文本

更完整的说明见 [PRIVACY.md](./PRIVACY.md)。

## 测试

```bash
npm test
```

当前验证包括：

- 类型检查
- 单元测试
- 构建验证
- 浏览器 smoke test

## License

MIT，见 [LICENSE](./LICENSE)。

欢迎与我交流，也欢迎提交 issue 和 PR。

本项目积极参与并认可 [linux.do社区](linux.do)。
