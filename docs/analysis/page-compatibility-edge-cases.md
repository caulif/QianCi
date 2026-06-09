# 页面兼容性边界分析

更新时间：2026-06-09

## 本轮已验证修复

- 链接内标注词：点击模式下，点击 `<a>` 内的标注词会打开释义卡片，并阻止父链接默认跳转与冒泡点击处理。
- 活动文本选择：如果用户正在拖选或保留非折叠选区，点击标注词不会触发查词，也不会取消页面点击事件。
- 编辑与表单区域：跳过 `input`、`textarea`、`select`、`button`、`[role="textbox"]`、`[contenteditable]:not([contenteditable="false"])`。
- 隐藏与非阅读区域：跳过 `[hidden]`、`[inert]`、`[aria-hidden="true"]`、`svg`、`math`、`canvas`、`audio`、`video`、`iframe`。
- 内联隐藏样式：跳过 `display: none`、`visibility: hidden`、`visibility: collapse` 的祖先子树。
- 常见隐藏工具类：跳过 `.d-none`、`.hidden`、`.is-hidden`、`.visually-hidden`、`.sr-only`，移除隐藏类后自动恢复扫描。
- Computed 视觉隐藏：对样式表驱动的 `visibility: hidden/collapse`、`opacity: 0`、`content-visibility: hidden`、selector-only `[data-*]` 隐藏、零尺寸 overflow 裁剪、clip/clip-path 微小裁剪和远距离 offscreen 定位进行跳过，恢复可见后自动标注。
- 隐藏恢复：内联隐藏样式移除后自动重新扫描，让动态 reveal 的内容可继续被标注。
- 折叠详情：关闭的 `<details>` 只保留 `summary` 原生行为，正文内容等打开后再标注。
- 原生弹层：关闭的 `<dialog>` 不提前标注，设置 `open` 后再扫描，避免改写尚未展示的弹层内容。
- ARIA 受控面板：只在控制器 `aria-expanded="false"` 且通过 `aria-controls` 明确指向面板时跳过被控面板，不跳过控制器本身。
- ARIA Tabs：只在 `[role="tab"][aria-selected="false"]` 通过 `aria-controls` 明确指向 `[role="tabpanel"]` 时跳过未选中面板；普通 `aria-selected` 控件不参与。
- Bootstrap Collapse：跳过 `.collapse:not(.show)` 与 `.collapsing`，等 `.collapse.show` 后再标注；若面板已 `.show`，即使 ARIA 状态过期也优先按可见内容处理。
- Bootstrap Dropdown/Overlay：跳过 `.dropdown-menu:not(.show)`、`.modal:not(.show)`、`.offcanvas:not(.show)`，等 `.show` 或 `.showing` 后再标注，移除可见类后自动清理。
- Native/Radix 弹层：跳过关闭的 `[popover]` 和 `data-state="closed"` 的弹层内容；native popover 通过 `toggle` 事件接入 `showPopover()`/`hidePopover()` 这类不改 DOM 属性的状态变化。
- Bootstrap Tabs：跳过 `.tab-pane:not(.active)`；对 `.tab-pane.fade.active` 等待 `.show` 后再标注，避免过渡期提前改写。
- 自定义交互控件：跳过 `summary`、`label`、`[role="button"]`、`[role="link"]`、`[role="menuitem"]`、`[role="tab"]`、`[role="option"]`、`[role="checkbox"]`、`[role="radio"]`、`[role="switch"]`、`[role="slider"]`、`[role="combobox"]`、`[role="listbox"]`、`[role="searchbox"]`。
- 页面 landmark 噪声区：跳过 `nav`、`[role="navigation"]`、页面级 `footer` 和 `[role="contentinfo"]`，避免菜单、面包屑和页脚辅助链接被自动标注；`main article` 正文仍可标注。
- ARIA live/toast 区域：跳过 `[aria-live]:not([aria-live="off"])`、`role=status`、`role=alert`、`role=log`，避免动态播报区被自动改写并造成读屏噪声；移除 live 语义后可恢复标注。
- Fixed/sticky 顶部遮挡：tooltip 定位会采样 viewport 顶部 fixed/sticky 元素，并把顶部安全区传给 placement，避免查词卡片被固定头部盖住。
- 页面局部忽略：支持 `.qianci-ignore` 与 `[data-qianci-ignore]` 标记，保护站点小组件、侧栏、广告位或自定义容器。
- 动态忽略区：当已标注区域运行中变成 `.qianci-ignore`、隐藏区或交互控件时，会自动移除内部标注并恢复文本。
- 标注清理：自动标注被移除后会合并相邻文本节点，降低重扫、定位和虚拟列表复用时的碎片风险。
- late open Shadow DOM：自定义元素在初次扫描后才 attach open shadow root 时，会在低频限次发现窗口内接入观察并标注，不进入 closed shadow root。
- Web Components slot：有 assigned light-DOM 内容时跳过 shadow slot fallback 文本，避免标注实际未渲染的 fallback；无 assigned 内容时 fallback 本身可见，应正常标注；`slotchange` 时自动在 assigned/fallback 两种状态之间切换。
- Web Components 未分发 light DOM：shadow host 下没有匹配 slot 的 light-DOM 子树不会被渲染，应跳过；shadow root 内真实可见文本仍可标注。
- 真实浏览器 smoke：生产构建 bundle 已覆盖普通文章 hover 查词、链接内 click 查词、fixed header tooltip 避让、活动选区不查词、动态忽略区清理、页面 landmark 噪声区、ARIA live/toast、内联隐藏样式与恢复、常见隐藏工具类与恢复、computed 视觉隐藏、零尺寸 measurement row、屏幕阅读器专用隐藏文本、关闭/打开 details、关闭/打开 dialog、native/Radix popover、ARIA accordion、ARIA tabs、Bootstrap collapse、Bootstrap dropdown、Bootstrap tabs/fade、open/late Shadow DOM、slot assigned/fallback、动态 slotchange、未分发 light DOM、iframe 默认跳过、虚拟行复用、交互/隐藏/图形/忽略区域不标注。

## 开源项目可借鉴做法

- Hypothesis client：只包裹 Range 内文本节点，使用 Shadow DOM 隔离 UI；iframe 采用显式 `enable-annotation` opt-in；点击高亮时结合 `elementsFromPoint` 与 `event.composedPath()` 处理命中与自家 UI 排除。
- mark.js：默认排除脚本和文档元结构，调用方可传 `exclude`；iframe 默认关闭，显式开启后带加载等待和超时跳过。
- web-highlighter：通过 `$root` 限定标注范围，通过 `exceptSelectors` 排除区域；事件回调交给业务层决定是否阻止页面默认行为。
- web.dev react-window：虚拟列表只渲染可视窗口，离开窗口的 DOM 节点会被回收或替换，因此 QianCi 需要验证复用节点不会保留旧词标注。
- MDN Shadow DOM：`open` shadow root 可通过 `shadowRoot` 访问，`closed` shadow root 会返回 `null`，因此 QianCi 只承诺处理 open shadow root。
- Chrome Content Scripts：`all_frames` 决定内容脚本是否注入所有匹配 frame；QianCi 当前 smoke 维持默认 iframe 跳过策略。
- MDN `<details>` 与 Bootstrap Collapse/Dropdown：折叠或浮层内容不一定适合立即标注；通用策略应优先依赖标准属性或明确的组件状态。
- Bootstrap 与 Tailwind 可访问性工具类：`.visually-hidden`、`.sr-only` 常用于仅暴露给屏幕阅读器的辅助文本，自动标注会改写不可见标签和可访问名称，应按隐藏内容处理。
- Tailwind/Bootstrap 视觉工具类：`invisible`、`opacity-0`、Bootstrap `.invisible` 等通过样式表让元素不可见但仍保留 DOM，QianCi 应读取 computed style，而不是只看 inline style。
- MDN Popover 与 Radix UI：native popover 打开状态依赖 `:popover-open` 和 `toggle` 事件；Radix Content 常通过 `data-state="open|closed"` 表达 mounted overlay 状态。
- MDN slot：`HTMLSlotElement.assignedNodes()` 可判断 slot 是否渲染 light-DOM 分发内容；存在 assigned nodes 时 fallback 内容不应作为当前可见正文处理。
- MDN assignedSlot：light-DOM 节点的 `assignedSlot` 为空时，说明它没有被 shadow tree 中的 slot 渲染，应避免误当作正文。
- MDN slotchange：slot 分发变化不会改写 fallback 文本本身，需要监听 `slotchange` 才能清理旧 fallback 标注或恢复 fallback 标注。
- WAI-ARIA Landmarks：`navigation`、`contentinfo` 主要表达页面结构和辅助导航，自动标注会增加非正文噪声；正文优先落在 `main`/`article`。
- WAI-ARIA Live Regions：`aria-live`、`status`、`alert`、`log` 用于动态播报，自动插入标注 wrapper 会改变播报内容和更新节奏，应默认跳过。

## 下一批建议边界用例

- 同源 iframe 默认不进入；后续如果要支持，应提供站点级 opt-in、超时、跨域异常跳过和诊断原因。
- open Shadow DOM 保持支持，继续强化 late attach 与 slot 分发；对 closed Shadow DOM 记录为不可标注，不尝试绕过。
- 增加用户自定义排除选择器配置，在 `.qianci-ignore` 基础上支持 `.toolbar`、`.dropdown`、`.modal`、`.code-block` 等站点级规则。
- 对 HeadlessUI tabs 继续谨慎扩展，优先信任 `hidden`、卸载和 ARIA 成对关系，不依赖框架私有 `data-*`。
- 对页面 CSS 高风险容器增加诊断：`display: contents`、`position: fixed` 工具栏、大量虚拟列表节点。
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
| Wikipedia | 大量内链、引用、表格、infobox、脚注 | 正文可标注；引用编号/目录/infobox 少标注；内链点击和 hover preview 正常 | P0 |
| SPA 动态流 | 虚拟滚动、节点复用、频繁卸载重挂 | 滚动后无重复嵌套；卸载节点不残留 tooltip；CPU 不持续飙高 | P0 |
| 虚拟列表/大表格 | 只渲染可视窗口，行高测量敏感 | 标注不改变滚动位置；快速滚动无错位；复用行不带错词标注 | P0 |
| 表单/编辑器 | contenteditable、Monaco、CodeMirror、撤销栈、IME | 自动不标注编辑区；手动选词查词不改内容；输入/撤销正常 | P0 |
| 搜索结果页 | 标题链接、摘要、广告、动态重排 | 结果链接点击不被阻断；搜索框不标注；重排后无重复标注 | P1 |
| Web Components | open/closed shadow root、late attach、slot 分发、组件事件 | open shadow 可标注；late attach 自动接入；closed shadow 不报错；slot 内容不重复标注 | P1 |
| iframe 嵌入 | 同源/跨源限制、独立滚动上下文 | 默认跳过不报错；主文档可标注；未来 opt-in 后 frame 独立统计 | P1 |
| 导航菜单密集页 | hover mega menu、按钮 tooltip、z-index 冲突 | 菜单展开正常；按钮文字不标注；QianCi tooltip 不遮挡关键菜单 | P1 |
| 学术/PDF HTML | 公式、引用、脚注、PDF text layer 重建 | HTML 正文可标注；公式少干扰；动态文本层不重复标注 | P2 |
