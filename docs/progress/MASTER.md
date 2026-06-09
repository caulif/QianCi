# 潜词项目进度

更新时间：2026-06-09

## 当前目标

优化页面兼容性，尽可能覆盖不同页面架构与边界场景，持续参考成熟开源方案并使用真实浏览器验证。

## 本轮完成

- 修复链接内标注词在点击查词模式下直接触发跳转的问题。
- 修复活动文本选择与点击查词冲突，保留用户拖选/复制路径。
- 扩展安全跳过区域，避免改写编辑器、隐藏内容、图形/媒体节点、iframe、ARIA 自定义控件、`summary` 和 `label`。
- 增加 `.qianci-ignore` 与 `[data-qianci-ignore]`，允许页面或站点适配规则局部 opt-out。
- 增加页面 landmark 噪声区兼容：跳过导航、面包屑和页脚辅助区域，保留 `main article` 正文标注。
- 增加 ARIA live/toast 兼容：跳过动态播报区，避免标注 wrapper 干扰读屏更新。
- 增加 fixed/sticky header 避让：tooltip 打开时探测顶部固定遮挡，并优先放到安全区内。
- 增加动态忽略区清理：已标注区域运行中变成忽略/隐藏/控件区域时自动 unwrap。
- 增加内联隐藏样式与闭合 details 兼容：不可见内容不提前标注，details 打开后再扫描正文。
- 增加常见隐藏工具类兼容：`.d-none`、`.hidden`、`.is-hidden` 不提前标注，移除后再扫描。
- 增加屏幕阅读器专用隐藏文本兼容：`.visually-hidden`、`.sr-only` 不提前标注，恢复视觉可读后再扫描。
- 增加 computed 视觉隐藏兼容：样式表驱动的 `visibility:hidden`、`opacity:0`、`content-visibility:hidden`、clip 和 offscreen 区域不提前标注。
- 增加 selector-only computed hidden 兼容：支持 `[data-*]` 等属性选择器控制的隐藏区域，并在属性移除后恢复扫描。
- 增加虚拟列表 measurement row 兼容：零尺寸 overflow 裁剪区域不提前标注，变为可测量后恢复扫描。
- 增加原生 dialog 兼容：关闭弹层不提前标注，打开后再扫描正文。
- 增加 ARIA accordion 与 Bootstrap collapse 兼容：只跳过明确折叠的被控面板，展开或 `.show` 后再扫描。
- 增加 Bootstrap dropdown/modal/offcanvas 浮层兼容：隐藏浮层不提前标注，显示后再扫描，隐藏时清理已有标注。
- 增加 native/Radix 弹层兼容：关闭的 `[popover]` 与 `data-state="closed"` mounted overlay 不提前标注，打开后再扫描，关闭后清理。
- 增加 ARIA tabs 与 Bootstrap tabs/fade 兼容：未选中或过渡中的 tabpanel 不提前标注，切换为可见后再扫描。
- 增加 late open Shadow DOM 兼容：自定义元素后挂载 open shadow root 时低频限次发现并接入观察。
- 增加 Web Components slot 兼容：有 assigned nodes 时跳过未渲染 fallback，只标注实际 slotted 文本；无 assigned nodes 时保留可见 fallback 标注。
- 增加 Web Components 未分发 light DOM 兼容：shadow host 下无匹配 slot 的 light-DOM 子树不自动标注。
- 增加动态 slotchange 兼容：运行中添加或移除 assigned 内容时，fallback 标注会自动清理或恢复。
- 增加标注清理 normalize，避免暂停、重扫和虚拟列表复用后留下碎片文本节点。
- 拆出 `src/content/domCompatibility.ts`，集中维护跳过规则、点击让路、选区检测和标注清理，`src/content/app.ts` 保持在 1000 行以内。
- 新增 `tests/unit/content-compat.test.ts`，覆盖链接点击、编辑/隐藏/非 HTML 区域、自定义交互控件。
- 新增 `tests/unit/content-compat-live-regions.test.ts`，独立覆盖 ARIA live/status/toast 区域。
- 扩展 `scripts/smoke-extension.ts`，生产构建 smoke 新增真实 Chromium 兼容页面，覆盖链接、选区、忽略区、open/late Shadow DOM、Bootstrap dropdown、iframe 默认跳过、虚拟行复用和交互区。
- 新增 `docs/analysis/page-compatibility-edge-cases.md`，记录开源项目经验和后续边界清单。

## 验证证据

- `npm test` 通过。
- 单元测试结果：26 个测试文件、235 个测试全部通过。
- 构建通过，生成最新 `dist`。
- e2e smoke 通过，覆盖普通文章 hover 查词、兼容页面 click 查词、late Shadow DOM 与 Bootstrap dropdown。

## 下一步

- 设计站点级自定义排除选择器列表，在 `.qianci-ignore` 基础上支持用户配置。
- 明确 iframe 策略：默认跳过，未来仅同源且显式 opt-in。
- 继续用真实网页样例测试：新闻文章、文档站、GitHub 页面、搜索结果页、含大量链接的导航页、Web Components 页面。
- 继续拆分 `src/content/app.ts` 的扫描/observer 队列逻辑，进一步降低后续动态页面适配风险。
- 评估 HeadlessUI/站点私有 tabs 的可靠 opt-in 规则，优先基于 `hidden`、卸载和 ARIA 成对关系。
