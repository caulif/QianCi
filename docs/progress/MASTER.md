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
- 拆出 `scripts/smoke-pages.ts`，把真实 Chromium smoke 的 HTML 夹具和 Chrome API stub 从主烟测流程分离，降低 `scripts/smoke-extension.ts` 后续扩展风险。
- 参考 Mozilla Readability 对 `meta`、`share`、`related`、`tags`、广告和 byline 的负向候选经验，新增阅读页噪声区跳过规则。
- 增加文章元信息、目录、分享栏、广告位、相关推荐和标签区兼容，正文仍保持自动标注。
- 增加动态 `[hidden]`、`[inert]`、`aria-hidden` 属性恢复与隐藏后清理的回归测试。
- 增加 `pre/code`、Monaco、CodeMirror 与旧版 CodeMirror 自动跳过测试，覆盖文档站和代码阅读页的核心风险。
- 扩展真实 Chromium smoke，生产 bundle 覆盖阅读页元信息、目录、分享栏、广告位、相关推荐、代码块和编辑器容器不标注。
- 增加 GitHub 风格 diff 与代码查看器兼容：跳过 `.blob-code`、`.blob-num`、`.diff-line-code`、`.diff-line-num`、`.react-code-lines`、`.js-file-line` 等代码宿主页区域，评论正文仍可标注。
- 增加 MDN/文档站高密度布局兼容：跳过左/右侧栏、面包屑、引用目录、元信息、浏览器兼容性表格和文章页脚，正文保留标注。
- 增加搜索结果页兼容：搜索表单、URL、结果 extras、广告、相关搜索和分页不标注，结果标题与摘要仍可标注。
- 增加多 idref 可访问名称组合测试，覆盖 `aria-labelledby` 多目标、`aria-errormessage`、共享说明文本和引用目标切换。
- 增加 SPA 多轮快速 route 替换测试和真实 Chromium smoke，验证 URL 变化与连续 DOM 替换后旧 tooltip 隐藏、旧词不残留、最终路由只标注一次。
- 收窄 GitHub 文件级跳过策略：不再跳过整块 `.js-file`，只跳过文件头、diff progressive container、hunk、代码行和 gutter，让 PR 文件内 `.comment-body` / `.markdown-body` review comment 保持可标注。
- 增加 GitHub lazy diff 回归：页面初扫后动态插入 file header、progressive diff 和 hunk 时不标注，内联 review comment 继续标注。
- 增加搜索结果动态重排回归：自然结果已标注后插入广告并移动结果卡，广告、PAA、sitelinks 不标注，自然标题/摘要不重复、不嵌套。
- 增加绝对定位虚拟列表回归：模拟 react-window/TanStack Virtual 的 spacer + `transform: translateY()` 行复用，验证测量行不标注、快速滚动后 `scrollTop` 稳定、旧词清理、新词只标注一次。
- 增加 Headless UI mounted panel 兼容：`data-closed`、`data-headlessui-state="closed"` 关闭/过渡中内容不标注，移除关闭状态后恢复标注，运行中进入关闭状态会清理既有标注。
- 增加页面自有 tooltip/floating portal 兼容：`role=tooltip`、`data-floating-ui-portal`、`data-radix-popper-content-wrapper` 不标注，避免网页自身提示层、Floating UI portal 和 Radix popper 被自动改写。
- 增加 PDF.js/文档阅读器文本层兼容：`textLayer`、`annotationLayer`、`xfaLayer` 不自动标注，避免破坏 PDF 坐标文本层、链接注释层和表单层；PDF 旁边的 HTML 摘要仍可标注。
- 增加 PDF.js 懒加载页面回归：页面初扫后动态插入 textLayer 时仍不标注。
- 增加学术论文 HTML 兼容：作者元信息、citation link、inline citation、公式编号、doc footnote、footnotes、bibliography 不标注，abstract 和正文保留标注。
- 增加懒加载 citation popup 回归：页面初扫后动态插入 `citation-tooltip` / `role=tooltip` 引用预览时不标注。
- 增加电商/产品页兼容：价格、SKU、评分、变体、数量、购买按钮、物流、优惠和 schema.org 交易元信息不标注，产品描述和评论正文保留标注。
- 拆出 `scripts/smoke-assertions.ts`，复用真实浏览器 smoke 的“区域不标注”和“正文标注可见”断言，避免 `scripts/smoke-extension.ts` 继续膨胀。
- 增加 Cookie/同意管理与营销浮层兼容：OneTrust、Cookiebot、cookie/GDPR/privacy banner、newsletter/subscribe popup、promo banner 和 announcement bar 不标注，正文中讨论 cookie/privacy 的段落保留标注。
- 增加扫描性能调度：视口附近正文优先、滚动/选区/tooltip 交互时短暂让步、高频 mutation 降频，并在页面诊断中暴露扫描片和队列指标。

## 验证证据

- `npm test` 通过。
- 单元测试结果：42 个测试文件、284 个测试全部通过。
- 构建通过，生成最新 `dist`。
- e2e smoke 通过，覆盖普通文章 hover 查词、兼容页面 click 查词、built manifest top-frame-only、fixed header/footer tooltip 避让、late Shadow DOM、Bootstrap dropdown、语义保护区、可访问名称保护、无 role 交互控件、computed hidden 恢复和虚拟滚动不漂移。
- `npx vitest run tests/unit/content-compat.test.ts tests/unit/content-compat-article-noise.test.ts` 通过，2 个测试文件、32 个测试通过。
- `npx vitest run tests/unit/content-compat-editors.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npx vitest run tests/unit/content-compat-code-hosts.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npx vitest run tests/unit/content-compat-high-density-pages.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npx vitest run tests/unit/content-compat-a11y-names.test.ts tests/unit/content-compat-code-hosts.test.ts` 通过，2 个测试文件、5 个测试通过。
- `npx vitest run tests/unit/content-compat-spa.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增 GitHub/MDN/搜索与 SPA 多轮替换断言。
- `npm test` 通过，完整链路包含 typecheck、42 个单元测试文件、284 个测试、生产构建和 e2e smoke。
- `npx vitest run tests/unit/content-compat-code-hosts.test.ts tests/unit/content-compat-high-density-pages.test.ts` 通过，2 个测试文件、7 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增 lazy GitHub diff、SERP 动态广告/重排、绝对定位虚拟列表复用断言。
- `npm run typecheck && npm run test:e2e` 通过，生产 smoke 覆盖拆分后的页面夹具。
- `npx vitest run tests/unit/content-compat-headless-ui.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增 Headless UI mounted closed panel 断言。
- `npx vitest run tests/unit/content-compat-headless-ui.test.ts` 通过，1 个测试文件、3 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增页面自有 tooltip、Floating UI portal 和 Radix popper 断言。
- `npx vitest run tests/unit/content-compat-pdf-viewers.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增 PDF.js textLayer、annotationLayer、xfaLayer 和懒加载 textLayer 断言。
- `npx vitest run tests/unit/content-compat-academic-pages.test.ts` 通过，1 个测试文件、2 个测试通过。
- `npm run build && npm run test:e2e` 通过，生产 smoke 新增学术论文引用/脚注/参考文献和懒加载 citation popup 断言。
- `npx vitest run tests/unit/content-compat-commerce-pages.test.ts` 通过，1 个测试文件、1 个测试通过。
- `npx tsc --noEmit -p tsconfig.node.json` 通过，新增 smoke assertion helper 类型检查通过。
- `npx vitest run tests/unit/content-compat-overlays.test.ts` 先失败后通过，覆盖静态和动态插入的同意/营销浮层。
- `npm test` 通过，完整链路覆盖扫描性能调度、生产构建和 e2e smoke；`src/content/app.ts` 已拆分到 1000 行以内。

## 下一步

- 设计站点级自定义排除选择器列表，在 `.qianci-ignore` 基础上支持用户配置。
- 设计 iframe opt-in：默认跳过已落地，下一步仅允许同源且站点策略显式开启，并在 diagnostics 中区分 top-frame/frame。
- 继续用真实网页样例测试：新闻文章、文档站、GitHub 页面、搜索结果页、含大量链接的导航页、Web Components 页面。
- 继续拆分 `src/content/app.ts` 的扫描/observer 队列逻辑，进一步降低后续动态页面适配风险。
- 抽出可访问引用、交互面、occlusion 和 shadow discovery helper，避免 `app.ts` 后续接近 1000 行上限。
- 评估 HeadlessUI/站点私有 tabs 的可靠 opt-in 规则，优先基于 `hidden`、卸载和 ARIA 成对关系。
- 继续补充 GitHub Issue/PR 真实页面 fixture，验证 `.discussion-sidebar`、`.Layout-sidebar`、`.discussion-timeline-actions` 在动态加载后也不改写。
- 继续补充可访问名称引用目标卸载、隐藏和多个控件跨区域共享说明的真实 DOM 变化。
- 补充搜索结果页更复杂结构：站点链接展开、People also ask 答案展开、无限滚动追加结果和摘要懒加载。
- 补充虚拟列表真实库示例：react-window/TanStack Virtual 的快速滚动、多行池复用和横向虚拟表格。
- 继续补充组件库状态：Headless UI menu/listbox、Radix select/combobox、floating-ui 动画结束后的清理和 portal 内事件互不干扰。
- 继续补充文档阅读器：PDF.js 多页卸载/重挂、学术论文 HTML 的脚注悬浮预览、公式编号和参考文献回跳。
- 继续补充学术页面：JATS 表格脚注、arXiv 侧栏目录、跨引用 hover card、参考文献筛选/折叠。
- 继续补充电商页面：Amazon/Shopify 风格商品页、动态优惠券、评价流懒加载、尺码/颜色选择器和库存状态切换。
- 继续补充同意/营销浮层：Didomi、TrustArc、IAB TCF CMP、privacy wall、订阅弹窗动画结束后的清理和正文 privacy/cookie 主题误伤回归。
