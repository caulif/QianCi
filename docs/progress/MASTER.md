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
- 增加百科/文档噪声区兼容：跳过 `aside`、`role=complementary`、MediaWiki 风格 `.infobox`、`.navbox`、`.reference`、`.reflist`。
- 增加 ARIA live/toast 兼容：跳过动态播报区，避免标注 wrapper 干扰读屏更新。
- 增加语义保护区兼容：跳过 `translate="no"`、`.notranslate`、KaTeX/MathJax 公式渲染、ruby 注音、忙碌区和复杂 ARIA widget。
- 增加可访问名称保护：跳过被控件 `aria-labelledby`、`aria-describedby`、`aria-errormessage` 引用的外部文本，并在引用移除后恢复扫描。
- 增加无 role 交互面保护：跳过 `onclick`、`tabindex>=0`、`aria-haspopup`、`data-action` 等站点自定义控件，同时保留原生链接内查词能力。
- 增加编辑器手动选词回归保护：`contenteditable` 自动不标注，但用户真实选区 Alt 查词可用，且编辑区 DOM 不被改写。
- 增加 fixed/sticky 遮挡避让：tooltip 打开时探测顶部 header 与底部 cookie/banner/footer 固定遮挡，并优先放到安全区内。
- 增加动态忽略区清理：已标注区域运行中变成忽略/隐藏/控件区域时自动 unwrap。
- 增加内联隐藏样式与闭合 details 兼容：不可见内容不提前标注，details 打开后再扫描正文。
- 增加常见隐藏工具类兼容：`.d-none`、`.hidden`、`.is-hidden` 不提前标注，移除后再扫描。
- 增加屏幕阅读器专用隐藏文本兼容：`.visually-hidden`、`.sr-only` 不提前标注，恢复视觉可读后再扫描。
- 增加 computed 视觉隐藏兼容：样式表驱动的 `visibility:hidden`、`opacity:0`、`content-visibility:hidden`、clip 和 offscreen 区域不提前标注。
- 增加 selector-only computed hidden 兼容：支持 `[data-*]` 等属性选择器控制的隐藏区域，并在属性移除后恢复扫描。
- 增加虚拟列表 measurement row 兼容：零尺寸 overflow 裁剪区域不提前标注，变为可测量后恢复扫描。
- 增加真实滚动容器虚拟列表 smoke：标注后 `scrollTop` 保持稳定，节点复用后旧词标注会被替换。
- 增加 transform/zero-box 隐藏兼容：`scale(0)` 与零尺寸裁剪盒不提前标注，恢复可见后再扫描。
- 明确 iframe 默认策略：manifest 默认不使用 `all_frames`，content 入口也会在非 top-frame 早退，未来只通过显式 opt-in 支持 frame。
- 增加原生 dialog 兼容：关闭弹层不提前标注，打开后再扫描正文。
- 增加 ARIA accordion 与 Bootstrap collapse 兼容：只跳过明确折叠的被控面板，展开或 `.show` 后再扫描。
- 增加 Bootstrap dropdown/modal/offcanvas 浮层兼容：隐藏浮层不提前标注，显示后再扫描，隐藏时清理已有标注。
- 增加 native/Radix 弹层兼容：关闭的 `[popover]` 与 `data-state="closed"` mounted overlay 不提前标注，打开后再扫描，关闭后清理。
- 增加 ARIA tabs 与 Bootstrap tabs/fade 兼容：未选中或过渡中的 tabpanel 不提前标注，切换为可见后再扫描。
- 增加 late open Shadow DOM 兼容：自定义元素后挂载 open shadow root 时低频限次发现并接入观察。
- 增加 nested late Shadow DOM 回归保护：外层 shadow 内的自定义元素后挂载内层 open shadow root 时也能被发现并标注。
- 增加 Web Components slot 兼容：有 assigned nodes 时跳过未渲染 fallback，只标注实际 slotted 文本；无 assigned nodes 时保留可见 fallback 标注。
- 增加 Web Components 未分发 light DOM 兼容：shadow host 下无匹配 slot 的 light-DOM 子树不自动标注。
- 增加动态 slotchange 兼容：运行中添加或移除 assigned 内容时，fallback 标注会自动清理或恢复。
- 增加标注清理 normalize，避免暂停、重扫和虚拟列表复用后留下碎片文本节点。
- 增加 SPA 路由替换清理：路由 root 整体替换时，如果旧节点包含已标注词，会隐藏旧 tooltip，并继续扫描新路由内容。
- 拆出 `src/content/domCompatibility.ts`，集中维护跳过规则、点击让路、选区检测和标注清理，`src/content/app.ts` 保持在 1000 行以内。
- 拆出 `src/content/mutationCompatibility.ts`，集中维护 mutation 中自家标注识别，给后续 SPA/动态页面兼容留出主流程空间。
- 新增 `tests/unit/content-compat.test.ts`，覆盖链接点击、编辑/隐藏/非 HTML 区域、自定义交互控件。
- 新增 `tests/unit/content-compat-live-regions.test.ts`，独立覆盖 ARIA live/status/toast 区域。
- 新增 `tests/unit/content-compat-semantic-guardrails.test.ts`，覆盖翻译 opt-out、公式/ruby、忙碌区和复杂 ARIA widget。
- 新增 `tests/unit/content-compat-a11y-names.test.ts`，覆盖外部可访问名称/说明文本保护和动态恢复。
- 新增 `tests/unit/content-compat-interactive-surfaces.test.ts`，覆盖无 role 可点击/可聚焦控件与原生链接回归。
- 新增 `tests/unit/content-frame-policy.test.ts`，覆盖 content app 默认只在 top-frame 启动。
- 新增 `tests/unit/content-compat-editors.test.ts`，覆盖真实 `contenteditable` Range 手动查词和 DOM 不变性。
- 新增 `tests/unit/content-compat-spa.test.ts`，覆盖 SPA route root 替换后的旧 tooltip 清理和新页面标注。
- 新增 `tests/unit/content-compat-article-noise.test.ts`，覆盖百科信息框、导航框、脚注和补充侧栏不标注。
- 新增 `tests/unit/content-mutation-compat.test.ts`，覆盖 mutation 中新增标注、移除容器和单个标注移除的区分。
- 扩展 `scripts/smoke-extension.ts`，生产构建 smoke 新增真实 Chromium 兼容页面，覆盖链接、选区、忽略区、open/late Shadow DOM、Bootstrap dropdown、iframe 默认跳过、虚拟行复用和交互区。
- 新增 `docs/analysis/page-compatibility-edge-cases.md`，记录开源项目经验和后续边界清单。

## 验证证据

- `npm test` 通过。
- 单元测试结果：34 个测试文件、255 个测试全部通过。
- 构建通过，生成最新 `dist`。
- e2e smoke 通过，覆盖普通文章 hover 查词、兼容页面 click 查词、built manifest top-frame-only、fixed header/footer tooltip 避让、late Shadow DOM、Bootstrap dropdown、语义保护区、可访问名称保护、无 role 交互控件、computed hidden 恢复和虚拟滚动不漂移。

## 下一步

- 设计站点级自定义排除选择器列表，在 `.qianci-ignore` 基础上支持用户配置。
- 设计 iframe opt-in：默认跳过已落地，下一步仅允许同源且站点策略显式开启，并在 diagnostics 中区分 top-frame/frame。
- 继续用真实网页样例测试：新闻文章、文档站、GitHub 页面、搜索结果页、含大量链接的导航页、Web Components 页面。
- 继续拆分 `src/content/app.ts` 的扫描/observer 队列逻辑，进一步降低后续动态页面适配风险。
- 抽出可访问引用、交互面、occlusion 和 shadow discovery helper，避免 `app.ts` 后续接近 1000 行上限。
- 评估 HeadlessUI/站点私有 tabs 的可靠 opt-in 规则，优先基于 `hidden`、卸载和 ARIA 成对关系。
