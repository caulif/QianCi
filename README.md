# 潜词 QianCi

潜词是一个极简浏览器扩展，专注在一个场景里把事情做好：当你阅读英文网页时，它会尽量安静地标出你大概率不认识的词，并在你需要时给出非常短的中文释义。

它不是整页翻译器，也不是学习平台。它更像一个克制的阅读助手。

## 现在能做什么

- 预判英文网页正文中的可能生词，并用低干扰虚线标注
- 悬停或点击标注词显示极简释义卡片
- `Alt + 选词` 手动查词
- 右键菜单手动查词
- 点击“认识”后移除标注，并记入熟词
- 自动记录生词与熟词
- 设置初始词汇水位线
- 切换划线颜色
- 切换悬停 / 点击触发模式
- 对不在本地词库中的单词做联网补查，并写入本地缓存

## 产品原则

- 干净
- 低打扰
- 低占用
- 越用越准

## 技术栈

- TypeScript
- Vite
- Manifest V3
- Vitest
- Playwright

## 本地开发

```bash
npm install
npm test
npm run build
```

构建产物在 `dist/`。

## 导入扩展

Chrome / Edge：

1. 运行 `npm run build`
2. 打开 `chrome://extensions` 或 `edge://extensions`
3. 打开“开发者模式”
4. 选择“加载已解压的扩展程序”
5. 选择项目里的 `dist` 目录

## 使用方式

- 标注词：
  - 根据设置，悬停或点击查看释义
- 漏判词：
  - `Alt + 选中单词`
  - 或右键菜单选择“翻译所选单词”
- 误判词：
  - 在卡片中点击“认识”
- 设置页：
  - 点击扩展图标打开

## 数据与词典

- 本地词典包基于 ECDICT 构建并精简
- 运行时使用生成后的 `src/data/dictionary.generated.json` 与 `src/data/rank.generated.json`
- 构建脚本在 `scripts/build-dictionary.ts`

## 联网补查

当本地词典里没有某个词时，用户可以手动触发联网查询。

当前使用：

- [FreeDictionaryAPI](https://freedictionaryapi.com/)
- [MyMemory Translation API](https://mymemory.translated.net/)

联网补查是按需触发的，不会在普通浏览时自动批量上传页面内容。

## 隐私

潜词默认使用本地词典和本地存储。

- 用户画像、生词、熟词、在线补查缓存都保存在浏览器本地
- 正常标注和本地查词不需要把网页正文发送到服务器
- 只有当用户主动点击“联网查询”时，才会把单个单词或单条英文释义发送给第三方服务

更完整的说明见 [PRIVACY.md](./PRIVACY.md)。

## 测试

```bash
npm test
```

当前测试覆盖：

- 单元测试
- 构建验证
- 基础 smoke test

## 当前范围

这个仓库当前聚焦在 MVP：

- 普通英文网页
- 单词级预判与查词

还没有做：

- 整句翻译
- PDF
- YouTube 字幕
- OCR
- 云同步
- 完整复习系统

## 路线提醒

现在的核心体验已经可用，但包体仍偏大。后续一个很值得继续做的方向，是进一步压缩词典加载和内容脚本体积。

## License

MIT. 见 [LICENSE](./LICENSE)。
