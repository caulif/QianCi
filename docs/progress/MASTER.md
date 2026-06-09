# 潜词项目进度

更新时间：2026-06-09

## 当前目标

优化页面兼容性，尽可能覆盖不同页面架构与边界场景，持续参考成熟开源方案并使用真实浏览器验证。

## 本轮完成

- 修复链接内标注词在点击查词模式下直接触发跳转的问题。
- 修复活动文本选择与点击查词冲突，保留用户拖选/复制路径。
- 扩展安全跳过区域，避免改写编辑器、隐藏内容、图形/媒体节点、iframe、ARIA 自定义控件、`summary` 和 `label`。
- 增加 `.qianci-ignore` 与 `[data-qianci-ignore]`，允许页面或站点适配规则局部 opt-out。
- 增加动态忽略区清理：已标注区域运行中变成忽略/隐藏/控件区域时自动 unwrap。
- 增加内联隐藏样式与闭合 details 兼容：不可见内容不提前标注，details 打开后再扫描正文。
- 增加常见隐藏工具类兼容：`.d-none`、`.hidden`、`.is-hidden` 不提前标注，移除后再扫描。
- 增加原生 dialog 兼容：关闭弹层不提前标注，打开后再扫描正文。
- 增加 ARIA accordion 与 Bootstrap collapse 兼容：只跳过明确折叠的被控面板，展开或 `.show` 后再扫描。
- 增加 ARIA tabs 与 Bootstrap tabs/fade 兼容：未选中或过渡中的 tabpanel 不提前标注，切换为可见后再扫描。
- 增加标注清理 normalize，避免暂停、重扫和虚拟列表复用后留下碎片文本节点。
- 拆出 `src/content/domCompatibility.ts`，集中维护跳过规则、点击让路、选区检测和标注清理，`src/content/app.ts` 降到 918 行左右。
- 新增 `tests/unit/content-compat.test.ts`，覆盖链接点击、编辑/隐藏/非 HTML 区域、自定义交互控件。
- 扩展 `scripts/smoke-extension.ts`，生产构建 smoke 新增真实 Chromium 兼容页面，覆盖链接、选区、忽略区、open Shadow DOM、iframe 默认跳过、虚拟行复用和交互区。
- 新增 `docs/analysis/page-compatibility-edge-cases.md`，记录开源项目经验和后续边界清单。

## 验证证据

- `npm test` 通过。
- 单元测试结果：23 个测试文件、203 个测试全部通过。
- 构建通过，生成最新 `dist`。
- e2e smoke 通过，覆盖普通文章 hover 查词和兼容页面 click 查词。

## 下一步

- 设计站点级自定义排除选择器列表，在 `.qianci-ignore` 基础上支持用户配置。
- 明确 iframe 策略：默认跳过，未来仅同源且显式 opt-in。
- 继续用真实网页样例测试：新闻文章、文档站、GitHub 页面、搜索结果页、含大量链接的导航页、Web Components 页面。
- 继续拆分 `src/content/app.ts` 的扫描/observer 队列逻辑，进一步降低后续动态页面适配风险。
- 评估 HeadlessUI/站点私有 tabs 的可靠 opt-in 规则，优先基于 `hidden`、卸载和 ARIA 成对关系。
