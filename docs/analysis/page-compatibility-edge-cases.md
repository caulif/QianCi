# 页面兼容性边界分析

更新时间：2026-06-09

## 本轮已验证修复

- 链接内标注词：点击模式下，点击 `<a>` 内的标注词会打开释义卡片，并阻止父链接默认跳转与冒泡点击处理。
- 活动文本选择：如果用户正在拖选或保留非折叠选区，点击标注词不会触发查词，也不会取消页面点击事件。
- 编辑与表单区域：跳过 `input`、`textarea`、`select`、`button`、`[role="textbox"]`、`[contenteditable]:not([contenteditable="false"])`。
- 编辑器手动选词：`contenteditable` 自动标注保持跳过，但真实 Range 选区触发 Alt 查词时仍可打开释义，且编辑区 `innerHTML` 不被插入 wrapper 或改写。
- 隐藏与非阅读区域：跳过 `[hidden]`、`[inert]`、`[aria-hidden="true"]`、`svg`、`math`、`canvas`、`audio`、`video`、`iframe`。
- 内联隐藏样式：跳过 `display: none`、`visibility: hidden`、`visibility: collapse` 的祖先子树。
- 常见隐藏工具类：跳过 `.d-none`、`.hidden`、`.is-hidden`、`.visually-hidden`、`.sr-only`，移除隐藏类后自动恢复扫描。
- Computed 视觉隐藏：对样式表驱动的 `visibility: hidden/collapse`、`opacity: 0`、`content-visibility: hidden`、selector-only `[data-*]` 隐藏、零尺寸 overflow 裁剪、clip/clip-path 微小裁剪和远距离 offscreen 定位进行跳过，恢复可见后自动标注。
- Transform/尺寸隐藏：对 `transform: scale(0)`、`scale(0, 0)`、`matrix(0,0,0,0,0,0)` 和零尺寸 overflow 裁剪盒进行跳过，避免标注不可见测量层或动画起点。
- 隐藏恢复：内联隐藏样式移除后自动重新扫描，让动态 reveal 的内容可继续被标注。
- 折叠详情：关闭的 `<details>` 只保留 `summary` 原生行为，正文内容等打开后再标注。
- 原生弹层：关闭的 `<dialog>` 不提前标注，设置 `open` 后再扫描，避免改写尚未展示的弹层内容。
- ARIA 受控面板：只在控制器 `aria-expanded="false"` 且通过 `aria-controls` 明确指向面板时跳过被控面板，不跳过控制器本身。
- ARIA Tabs：只在 `[role="tab"][aria-selected="false"]` 通过 `aria-controls` 明确指向 `[role="tabpanel"]` 时跳过未选中面板；普通 `aria-selected` 控件不参与。
- Bootstrap Collapse：跳过 `.collapse:not(.show)` 与 `.collapsing`，等 `.collapse.show` 后再标注；若面板已 `.show`，即使 ARIA 状态过期也优先按可见内容处理。
- Bootstrap Dropdown/Overlay：跳过 `.dropdown-menu:not(.show)`、`.modal:not(.show)`、`.offcanvas:not(.show)`，等 `.show` 或 `.showing` 后再标注，移除可见类后自动清理。
- Native/Radix 弹层：跳过关闭的 `[popover]` 和 `data-state="closed"` 的弹层内容；native popover 通过 `toggle` 事件接入 `showPopover()`/`hidePopover()` 这类不改 DOM 属性的状态变化。
- Headless UI mounted panel：跳过 `data-closed` 和 `data-headlessui-state="closed"` 的关闭/过渡中内容；移除关闭状态后恢复扫描，运行中进入关闭状态会清理既有标注。
- 页面自有 tooltip/floating portal：跳过 `role=tooltip`、`data-floating-ui-portal`、`data-radix-popper-content-wrapper`，避免网页自身 tooltip、Floating UI portal 和 Radix popper 内容被自动标注。
- PDF.js 文本/注释层：跳过 `.textLayer`、`.annotationLayer`、`.xfaLayer`，避免自动 wrapper 改变 PDF 坐标文本层、链接注释层和表单层；PDF 外围 HTML 摘要仍可标注。
- 学术论文 HTML：跳过 `.ltx_authors`、`.ltx_ref`、`.citation`、`.citation-tooltip`、`.ltx_tag_equation`、`role=doc-footnote`、`.footnotes`、`role=doc-bibliography`、`.bibliography`，避免改写作者元信息、引用、公式编号、脚注和参考文献；abstract 和正文仍可标注。
- Bootstrap Tabs：跳过 `.tab-pane:not(.active)`；对 `.tab-pane.fade.active` 等待 `.show` 后再标注，避免过渡期提前改写。
- 自定义交互控件：跳过 `summary`、`label`、`[role="button"]`、`[role="link"]`、`[role="menuitem"]`、`[role="tab"]`、`[role="option"]`、`[role="checkbox"]`、`[role="radio"]`、`[role="switch"]`、`[role="slider"]`、`[role="combobox"]`、`[role="listbox"]`、`[role="searchbox"]`。
- 无 role 交互面：跳过无标准 role 但带 `onclick`、`tabindex>=0`、`aria-haspopup`、`data-action` 的站点自定义控件，保护可点击卡片、菜单触发器和 action chip；原生 `<a href>` 仍按链接查词策略处理，不因 inline `onclick` 被整体跳过。
- 页面 landmark 噪声区：跳过 `nav`、`[role="navigation"]`、页面级 `footer` 和 `[role="contentinfo"]`，避免菜单、面包屑和页脚辅助链接被自动标注；`main article` 正文仍可标注。
- 百科/文档噪声区：跳过 `aside`、`[role="complementary"]`、MediaWiki 常见 `.infobox`、`.navbox`、`.reference`、`.reflist`，避免信息框、导航框、脚注和参考文献列表产生大量非正文标注。
- 阅读页噪声区：跳过 `time`、`.toc`、`.table-of-contents`、`.article-meta`、`.entry-meta`、`.post-meta`、`.byline`、`.share-bar`、`.social-share`、`.advertisement`、`.adsbygoogle`、`.related-posts`、`.related-articles`、`.recommended`、`.tags`，降低新闻、博客和文档页的元信息、目录、分享、广告和相关推荐干扰。
- 代码与编辑器区：跳过 `pre/code`、Monaco、CodeMirror 和旧版 `.CodeMirror` 容器，文档正文仍可标注，代码示例和富编辑器 DOM 不改写。
- GitHub/代码宿主页：跳过 `.blob-code`、`.blob-code-inner`、`.blob-num`、`.diff-line-code`、`.diff-line-num`、`.react-code-lines`、`.react-code-text`、`.js-file-line`、`.file-header`、`.js-diff-progressive-container`、`[data-hunk]`、`.discussion-sidebar`、`.Layout-sidebar`、`.js-issue-labels`、`.sidebar-assignee`、`.discussion-timeline-actions`，保护 diff gutter、代码行、文件头和 PR/Issue 侧栏；不跳过整块 `.js-file`，让 `.comment-body` / `.markdown-body` review comment 保持可标注。
- MDN/文档站高密度区：跳过 `.left-sidebar`、`.reference-toc`、`.layout__right-sidebar`、`.breadcrumbs`、`.article-footer`、`.metadata`、`.bc-table`，减少侧栏、目录、兼容性表格和元信息干扰。
- 搜索结果页噪声区：跳过 `form[role="search"]`、`.search__form`、`.result__url`、`cite`、`.result__extras`、`.result__sitelinks`、`.result--ad`、`.people-also-ask`、`.related-question`、`.related-searches`、`.pagination`；当前策略保留结果标题和摘要标注，让用户能在 SERP 摘要里继续学习。
- 搜索结果动态重排：自然结果已标注后，插入广告、移动结果卡、更新摘要时，广告/PAA/sitelinks 不标注，自然标题和摘要不重复、不嵌套。
- 电商/产品页噪声区：跳过 `.product-meta`、`.product-form`、`.product-actions`、价格、SKU、评分、变体选择、数量选择、购买按钮、物流、优惠券、促销和 schema.org `price/sku/ratingValue/reviewRating` 等交易元信息；产品描述和评论正文仍可标注。
- Cookie/同意管理与营销浮层：跳过 OneTrust、Cookiebot、cookie consent/banner、GDPR/privacy banner、newsletter/subscribe popup、promo banner 和 announcement bar；普通正文里讨论 cookie/browser privacy 的段落仍可标注，避免用 `[id*="cookie"]` 这类过宽规则。
- ARIA live/toast 区域：跳过 `[aria-live]:not([aria-live="off"])`、`role=status`、`role=alert`、`role=log`，避免动态播报区被自动改写并造成读屏噪声；移除 live 语义后可恢复标注。
- 语义保护区：跳过 `translate="no"`、`.notranslate`、`progress`、`meter`、KaTeX/MathJax 公式渲染、`rt/rp` ruby 注音、`aria-busy="true"` 和复杂 ARIA widget，避免改写产品名、公式层、加载中区域和非正文控件。
- 可访问名称引用：跳过被交互控件 `aria-labelledby`、`aria-describedby`、`aria-errormessage` 引用的外部文本，避免标注 wrapper 改变按钮/输入控件的可访问名称或说明；当引用属性移除时会扫描旧引用目标并恢复正文标注。
- Fixed/sticky 遮挡：tooltip 定位会采样 viewport 顶部和底部 fixed/sticky 元素，并把安全区传给 placement，避免查词卡片被固定头部、cookie banner 或 sticky footer 盖住。
- 页面局部忽略：支持 `.qianci-ignore` 与 `[data-qianci-ignore]` 标记，保护站点小组件、侧栏、广告位或自定义容器。
- 动态忽略区：当已标注区域运行中变成 `.qianci-ignore`、隐藏区或交互控件时，会自动移除内部标注并恢复文本。
- 动态属性隐藏：`[hidden]`、`[inert]`、`aria-hidden` 初始状态不标注；移除隐藏属性后恢复扫描；可见区域运行中变成隐藏属性后会清理既有标注。
- 标注清理：自动标注被移除后会合并相邻文本节点，降低重扫、定位和虚拟列表复用时的碎片风险。
- SPA 路由替换：当 route root 整体替换并移除旧标注词时，会隐藏旧 tooltip，避免 orphan card 留在新页面；新路由内容仍会继续进入扫描队列。
- SPA 多轮快速替换：连续 `history.pushState/replaceState` 与 route root 多次替换后，旧 tooltip 隐藏、旧词 wrapper 不残留，最终路由只出现一组标注。
- 虚拟滚动容器：真实浏览器 smoke 会先滚到中段再等待标注，验证 `scrollTop` 不因 wrapper 插入漂移；复用行文本替换后，旧词标注会消失，新词标注会恢复。
- 绝对定位虚拟列表：模拟 spacer + `position:absolute` + `transform: translateY()` 的 react-window/TanStack Virtual 行复用，测量行不标注，快速滚动后 `scrollTop` 稳定，复用行旧词清理、新词仅标注一次。
- late open Shadow DOM：自定义元素在初次扫描后才 attach open shadow root 时，会在低频限次发现窗口内接入观察并标注，不进入 closed shadow root。
- nested late Shadow DOM：外层 shadow root 内的自定义元素如果后续再 attach 内层 open shadow root，也会被低频发现并接入观察；host 的未分发 light DOM 仍不误标注。
- Web Components slot：有 assigned light-DOM 内容时跳过 shadow slot fallback 文本，避免标注实际未渲染的 fallback；无 assigned 内容时 fallback 本身可见，应正常标注；`slotchange` 时自动在 assigned/fallback 两种状态之间切换。
- Web Components 未分发 light DOM：shadow host 下没有匹配 slot 的 light-DOM 子树不会被渲染，应跳过；shadow root 内真实可见文本仍可标注。
- iframe 默认策略：manifest 默认不再设置 `all_frames: true`，content 入口在非 top-frame 会早退；顶层 DOM walker 仍跳过 `<iframe>` 元素本身，未来仅通过同源且显式 opt-in 支持 frame 内标注。
- 真实浏览器 smoke：生产构建 bundle 已覆盖普通文章 hover 查词、链接内 click 查词、built manifest top-frame-only、fixed header/footer tooltip 避让、活动选区不查词、动态忽略区清理、页面 landmark 噪声区、阅读页元信息/目录/分享/广告/相关推荐噪声区、代码块与编辑器容器、GitHub diff/code view、lazy GitHub diff、MDN 高密度布局、PDF.js text/annotation/XFA 层与懒加载 textLayer、学术论文引用/脚注/参考文献和懒加载 citation popup、搜索结果页噪声区、SERP 动态广告/重排、SPA 多轮 route 替换、ARIA live/toast、语义保护区、可访问名称外部引用、无 role 交互控件、内联隐藏样式与恢复、常见隐藏工具类与恢复、computed 视觉隐藏、transform/零尺寸隐藏、零尺寸 measurement row、屏幕阅读器专用隐藏文本、关闭/打开 details、关闭/打开 dialog、native/Radix popover、Headless UI mounted closed panel、页面自有 tooltip/floating portal、ARIA accordion、ARIA tabs、Bootstrap collapse、Bootstrap dropdown、Bootstrap tabs/fade、open/late Shadow DOM、slot assigned/fallback、动态 slotchange、未分发 light DOM、iframe 默认跳过、虚拟滚动不漂移、普通/绝对定位虚拟行复用、交互/隐藏/图形/忽略区域不标注。

## 开源项目可借鉴做法

- Hypothesis client：只包裹 Range 内文本节点，使用 Shadow DOM 隔离 UI；iframe 采用显式 `enable-annotation` opt-in；点击高亮时结合 `elementsFromPoint` 与 `event.composedPath()` 处理命中与自家 UI 排除。
- mark.js：默认排除脚本和文档元结构，调用方可传 `exclude`；iframe 默认关闭，显式开启后带加载等待和超时跳过。
- web-highlighter：通过 `$root` 限定标注范围，通过 `exceptSelectors` 排除区域；事件回调交给业务层决定是否阻止页面默认行为。
- mark.js：提供 `exclude` 选择器和 iframe 显式开关，iframe 加载异常会按超时跳过；QianCi 可借鉴为站点级排除选择器和 frame opt-in 策略。
- web.dev react-window：虚拟列表只渲染可视窗口，离开窗口的 DOM 节点会被回收或替换，因此 QianCi 需要验证复用节点不会保留旧词标注。
- MDN Shadow DOM：`open` shadow root 可通过 `shadowRoot` 访问，`closed` shadow root 会返回 `null`，因此 QianCi 只承诺处理 open shadow root。
- Chrome Content Scripts：`all_frames` 决定内容脚本是否注入所有匹配 frame；QianCi 当前采用 top-frame-only 默认策略，避免未授权 frame 内重复注入，后续 opt-in 再处理 frame 诊断和独立滚动上下文。
- MDN `<details>` 与 Bootstrap Collapse/Dropdown：折叠或浮层内容不一定适合立即标注；通用策略应优先依赖标准属性或明确的组件状态。
- Bootstrap 与 Tailwind 可访问性工具类：`.visually-hidden`、`.sr-only` 常用于仅暴露给屏幕阅读器的辅助文本，自动标注会改写不可见标签和可访问名称，应按隐藏内容处理。
- Tailwind/Bootstrap 视觉工具类：`invisible`、`opacity-0`、Bootstrap `.invisible` 等通过样式表让元素不可见但仍保留 DOM，QianCi 应读取 computed style，而不是只看 inline style。
- MDN Popover 与 Radix UI：native popover 打开状态依赖 `:popover-open` 和 `toggle` 事件；Radix Content 常通过 `data-state="open|closed"` 表达 mounted overlay 状态。
- MDN slot：`HTMLSlotElement.assignedNodes()` 可判断 slot 是否渲染 light-DOM 分发内容；存在 assigned nodes 时 fallback 内容不应作为当前可见正文处理。
- MDN assignedSlot：light-DOM 节点的 `assignedSlot` 为空时，说明它没有被 shadow tree 中的 slot 渲染，应避免误当作正文。
- MDN slotchange：slot 分发变化不会改写 fallback 文本本身，需要监听 `slotchange` 才能清理旧 fallback 标注或恢复 fallback 标注。
- WAI-ARIA Landmarks：`navigation`、`contentinfo` 主要表达页面结构和辅助导航，自动标注会增加非正文噪声；正文优先落在 `main`/`article`。
- WAI-ARIA Live Regions：`aria-live`、`status`、`alert`、`log` 用于动态播报，自动插入标注 wrapper 会改变播报内容和更新节奏，应默认跳过。
- WAI-ARIA Accessible Name：`aria-labelledby`、`aria-describedby`、`aria-errormessage` 常把控件名称或说明放在控件外部，自动改写这些外部文本会间接影响读屏读法，应把交互控件引用的目标视作保护区。
- KaTeX/MathJax 与 HTML ruby：公式渲染和注音层通常不是普通阅读正文，插入 wrapper 容易破坏排版、复制文本或辅助读法，应默认跳过。
- Mozilla Readability：成熟正文抽取器会把 byline、share、related、tag、广告、元信息等作为低正文概率信号；QianCi 不做整页正文抽取，但可把这些区域作为自动标注的默认低优先级或跳过区域。
- schema.org Product：价格、货币、SKU、GTIN、库存和评分字段是结构化交易信息，不适合插入学习标注；`description` 和用户评论正文更接近阅读内容，应保留。
- Mozilla Readability 的负向候选包含 `banner`、`gdpr`、`popup`、`promo` 等非正文信号；QianCi 采用更精确的 class/id 命中，避免把真实文章正文误当作 cookie 或 privacy 主题浮层。

## 下一批建议边界用例

- 同源 iframe 默认不进入已落地；后续如果要支持，应提供站点级 opt-in、超时、跨域异常跳过和诊断原因。
- open Shadow DOM 保持支持，继续强化 late attach 与 slot 分发；对 closed Shadow DOM 记录为不可标注，不尝试绕过。
- 增加用户自定义排除选择器配置，在 `.qianci-ignore` 基础上支持 `.toolbar`、`.dropdown`、`.modal`、`.code-block`、`[data-testid*="trigger"]` 等站点级规则。
- 对 HeadlessUI menu/listbox/tabs 继续谨慎扩展，优先信任 `hidden`、卸载、`data-closed` 和 ARIA 成对关系，不依赖过宽框架私有 `data-*`。
- 对页面 CSS 高风险容器增加诊断：`display: contents`、`position: fixed` 工具栏、大量虚拟列表节点。
- 对可访问名称继续扩展组合测试：多 idref、引用链路变更、被多个控件共享的说明文本、引用目标被隐藏或卸载。
- 对代码和编辑器继续扩展：GitHub 懒加载 diff、折叠文件展开、文件树、IME、撤销栈和 Alt 手动查词。
- 对 SPA 继续扩展：连续 route root 替换、`history.pushState/replaceState`、快速卸载重挂和旧 tooltip 清理。
- 对搜索结果页继续扩展：动态重排、广告插入、People also ask、站点链接和无限滚动。
- 对电商页面继续扩展：Shopify/Amazon 风格价格块、变体 picker、折扣券、配送承诺、评价摘要和用户评论流。
- 对同意/营销浮层继续扩展：OneTrust/Cookiebot 之外的 Didomi、TrustArc、IAB TCF CMP、地理区域化 privacy wall、动态插入和移除后的清理。
- 对 PDF/学术阅读器继续扩展：PDF.js 多页卸载重挂、JATS 表格脚注、跨引用 hover card、参考文献筛选/折叠和论文侧栏目录。
- 对动态 SPA 页面记录扫描切片耗时分位数，而不仅是最后一次耗时。
- 对虚拟列表增加更接近 react-window/TanStack Virtual 的高度与滚动位置断言。
- 对属性变更继续扩展：`style="display:none"`、`aria-expanded` 导致的折叠面板、站点自定义 class 规则。
- 任意属性驱动的 CSS 状态：站点常用 `data-*`、`aria-*`、自定义属性控制可见性，observer 不应只监听固定 attributeFilter。

## 真实页面测试矩阵

| 页面类型 | 核心风险 | 建议断言 | 优先级 |
| --- | --- | --- | --- |
| 新闻长文/博客 | 正文夹广告、推荐卡、懒加载段落、段内链接 | 主要正文可标注；广告/导航标注少；链接点击正常；懒加载段落可继续标注 | P0 |
| GitHub 代码/Issue/PR | 代码块、行号、diff gutter、按钮密集 | `pre/code` 不标注；Issue 评论正文可标注；文件树和按钮不受干扰 | P0 |
| MDN/文档站 | 正文、侧栏、目录、代码块、术语链接混合 | 正文可标注；代码示例不标注；目录/导航低打扰；tooltip 不被 sticky header 遮挡 | P0 |
| Wikipedia | 大量内链、引用、表格、infobox、脚注 | 已覆盖正文可标注、infobox/navbox/reference/reflist 不标注；后续补目录/hover preview | P0 |
| SPA 动态流 | 虚拟滚动、节点复用、频繁卸载重挂 | 已覆盖 route root 替换不残留旧 tooltip、新路由继续标注；后续补 URL 变化与多轮快速切换 | P0 |
| 虚拟列表/大表格 | 只渲染可视窗口，行高测量敏感 | 已覆盖滚动容器 `scrollTop` 不漂移和复用行不带错词标注；后续补快速滚动与真实库示例 | P0 |
| 表单/编辑器 | contenteditable、Monaco、CodeMirror、撤销栈、IME | 已覆盖 contenteditable 自动不标注和真实选区手动查词不改 DOM；后续补 Monaco/CodeMirror、IME、撤销栈 | P0 |
| 搜索结果页 | 标题链接、摘要、广告、动态重排 | 结果链接点击不被阻断；搜索框不标注；重排后无重复标注 | P1 |
| 电商/产品页 | 价格、评分、SKU、变体、购买按钮、优惠券与评论混排 | 交易控件和元信息不标注；产品描述和评论正文可标注 | P1 |
| Cookie/营销浮层 | 同意管理器、订阅弹窗、公告条、隐私墙与正文 privacy 主题混排 | 浮层不标注；正文 cookie/privacy 主题段落仍可标注；动态插入不重复扫描 | P1 |
| Web Components | open/closed shadow root、late attach、nested shadow、slot 分发、组件事件 | open shadow 可标注；late/nested attach 自动接入；closed shadow 不报错；slot 内容不重复标注 | P1 |
| iframe 嵌入 | 同源/跨源限制、独立滚动上下文 | 默认跳过不报错；主文档可标注；未来 opt-in 后 frame 独立统计 | P1 |
| 导航菜单密集页 | hover mega menu、按钮 tooltip、z-index 冲突 | 菜单展开正常；按钮文字不标注；QianCi tooltip 不遮挡关键菜单 | P1 |
| 学术/PDF HTML | 公式、引用、脚注、PDF text layer 重建 | HTML 正文可标注；公式少干扰；动态文本层不重复标注 | P2 |
