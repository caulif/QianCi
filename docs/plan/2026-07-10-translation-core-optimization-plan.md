# 潜词：翻译核心能力优化规划

日期：2026-07-10  
状态：**已按阶段实现（推荐默认）**  
范围：释义解析、离线词库命中、词库未命中时的联网补查、**标注词点击/悬停触发可靠性**、各页面兼容下的查词可达  
非范围：整页翻译、账号云同步、付费 API 必选、背词/SRS 平台化

> 潜词的产品定位是「阅读时安静标出可能不认识的词，需要时给出简短中文释义」。  
> **翻译（释义）是主路径**；联网是本地词库的补强，不是默认把整页送出去。  
> **有虚线就应能打开释义**；无虚线时仍应有选词 / 右键 / popup 可达路径。  
> 本文是后续「逐项实现、完成一项勾一项」的单一规划源；与交互体验规划、页面兼容分析互补，不重复重写已完成的 UX 表面改动。

---

## 1. 目标与完成判据（Done-means）

### 1.1 本轮总目标

把「看见英文词 → 得到可信、简短、可解释的中文释义」做成**稳定、可预期、可降级**的核心能力：

| 维度 | 目标 |
| --- | --- |
| **命中** | 离线档位内常见词即时释义；未命中可主动联网并写入本地缓存 |
| **可点** | 已标注词在链接、卡片、轻量交互容器、残留选区等常见页上仍能触发查词；触发失败时有备用入口 |
| **质量** | 优先词典义，其次「英文定义→中文」机翻，最后才是单词直译；展示来源可区分 |
| **可靠** | 超时/限流/服务不可用有分类提示、备用链路、重试队列与 provider 冷却 |
| **可控** | 可关联网；自定义释义优先；缓存与自定义可分清、可清空 |
| **场景** | 标注查词、手动选词、右键菜单、popup 快查、编辑区选词在兼容策略下一致 |
| **兼容** | 在复杂页面上查词不破坏页面；找不到词时仍能走手动路径 |

### 1.2 可机械验证的完成信号（全规划落地时）

- [x] 单元测试：离线解析、lemma、联网瀑布流各分支、错误分类、缓存写入优先级（custom > online > bundled）
- [x] 单元测试：tooltip / app 在「有词 / 无词关联网 / 无词开联网成功 / 失败可重试」四态文案与按钮正确
- [x] 单元测试：标注词触发——链接内 click、capture 抢事件、残留选区、hover 模式下 click 仍可查、键盘 Enter/Space
- [x] `npx vitest run` 相关用例通过；`npm run typecheck` 通过
- [x] 若改 manifest host_permissions 或 provider URL：`PRIVACY.md` 与 `README.md` 同步
- [x] 规划内任务 checkbox 全部勾选；未勾选项不得宣称「翻译核心已优化完成」

### 1.3 产品边界（硬约束）

- **不**做整页/段落自动翻译，不把页面正文上传。
- 联网默认**仅发送用户主动查询的单词**（及为得到中文而翻译的**短英文定义文本**，来自词典 API，不是页面 DOM）。
- 不破解 closed Shadow DOM；不默认注入所有 iframe。
- 不引入必须注册密钥才能用的「唯一」翻译依赖；密钥类能力若做，只能是可选增强。
- 释义展示坚持「短、可读」：卡片主文案不是长百科段落。

---

## 2. 现状架构（As-Is）

### 2.1 释义解析优先级

```text
用户触发查词(word)
  → normalize(lower/trim)
  → customDictionary[word]     // 含 source: custom | online（联网成功会写入同一 store）
  → 离线包(core→…→用户档位)   // exact + lemma 映射
  → 未命中
       ├─ 已关联网 → showMissing「本地没有…已关闭联网补查」
       └─ 已开联网 → showMissing「词库里没有」+「联网查询」
            → background fetchOnlineDictionaryEntry
            → 成功：upsert customDictionary(source: online) + 展示
            → 失败：分类错误 + 可入重试队列
```

关键实现位置：

| 环节 | 文件 |
| --- | --- |
| 离线解析 / 分档 | `src/content/dictionary.ts`、`src/core/dictionaryPacks.ts`、`scripts/build-dictionary.ts` |
| 词条模型 / 归属 | `src/core/dictionaryEntry.ts` |
| 查词 UI 状态机 | `src/content/app.ts`、`src/content/tooltip.ts`、`src/content/appHelpers.ts` |
| 注入与缓存写入 | `src/content/index.ts`、`src/storage/customDictionaryStore.ts` |
| 联网瀑布流 | `src/background/onlineDictionary.ts` |
| 消息与错误类型 | `src/core/messages.ts`、`src/background/worker.ts` |
| 重试队列 | `src/storage/onlineLookupQueueStore.ts` |
| 选词规范化 | `src/content/selection.ts`、`src/content/tokenize.ts` |
| 是否标注 | `src/core/decision.ts` + `ranks`（**无 rank 则不自动标注**） |
| 点击抑制 / 选区让路 | `src/content/domCompatibility.ts`（`suppressPageClick`、`hasActiveTextSelection`） |
| 标注 DOM | `src/content/annotator.ts`（`span.qianci-word` + `tabIndex=0` + `role=button`） |
| 跳过交互面 | `hasInteractiveSurfaceAncestor` 等（过宽会直接「无虚线」） |

### 2.1.1 触发链路（As-Is，与「点不了」直接相关）

```text
自动标注成功 → span[data-qianci-word]
  ├─ lookupTrigger === 'hover'
  │     mouseenter → resolveEntry → 有义才 showEntry（无义则静默）
  │     click → 直接 return（不查词）
  ├─ lookupTrigger === 'click'
  │     click → 若 hasActiveTextSelection 则 return
  │           → suppressPageClick(preventDefault + stopImmediatePropagation)
  │           → lookupWord
  └─ keydown Enter/Space → lookupWord（不依赖 lookupTrigger）

备用：Alt+选词 / 右键「用潜词查词」/ popup 快查（不依赖虚线）
```

已知脆弱点（代码事实，非猜测）：

1. **触发模式互斥**：`hover` 模式下点击标注词**完全不查**；触控设备虽有 `preferClickTriggerForPointer`，混合指针/用户手改设置后仍会「点了没反应」。
2. **监听在冒泡阶段**：`suppressPageClick` 只能管住「事件已经到标注词之后」；祖先 **capture** 导航/委托可能先跳转或 `stopPropagation`，用户体感为点了没开释义却整页跳走。
3. **残留选区一票否决**：页面上任意非折叠选区都会让 click 查词放弃（为保护拖选复制），但许多站点单击后仍留下 selection，导致「怎么点都不弹」。
4. **hover 无本地义静默**：已标注但 resolve 失败/无义时 hover 不提示，用户以为坏了。
5. **跳过过宽 → 根本无虚线**：`onclick` / `tabindex` / `data-action` / 部分 `data-testid` 交互面整段不标注，正文在「可点卡片」里时看起来像「这页词都点不了」。
6. **无 rank / 站点模式 / 噪声区**：词在页上但无标注，只能靠手动路径；若用户不知道 Alt/右键，等于不可用。
7. **遮挡层**：fixed 透明层、cookie 条、画中画等抢走 hit-test（tooltip 有避让，标注 click 无 hit 诊断）。

### 2.2 联网瀑布流（已实现）

```text
1) FreeDictionaryAPI（带 translations=true）
   ├─ 有中文义项 → 直接成条
   └─ 仅有英文 definition → MyMemory → Lingva → Google gtx 译成中文
2) 失败/限流/超时等 → dictionaryapi.dev
   └─ 英文 definition → 同上机翻链
3) 仍失败 → 对「单词本身」做机翻（机器翻译兜底）
4) Provider 级冷却 + 同词 in-flight 单飞
5) 可重试错误 → onlineLookupQueue + chrome.alarms
```

隐私与合规已在 `PRIVACY.md` 声明：FreeDictionary、dictionaryapi.dev、MyMemory、Lingva、Google gtx 兜底。

### 2.3 已有优势

- 错误种类齐全：`not_found | rate_limited | service_unavailable | network_error | timeout | parse_error`。
- 重试队列、popup/options 可见、可清空联网缓存与自定义释义区分说明。
- 自定义释义、改释义反馈路径已存在。
- 页面兼容矩阵厚：编辑器/代码/PDF/SPA/Shadow 等默认不误伤；手动选词在编辑区仍可查。
- 悬停自动查**仅本地有释义的已标注词**，不会因悬停刷爆联网（隐私与配额友好）。

### 2.4 核心缺口（本规划要解决）

| ID | 缺口 | 用户感知 |
| --- | --- | --- |
| T1 | 离线未命中必须再点「联网查询」，主路径多一步；失败文案偶发笼统 | 「词库里没有」后不知道该不该点、点了多久、失败为什么 |
| T2 | 机翻长英文 definition → 中文往往偏长、不像「阅读用短义」 | 卡片挤满一段话，不像词典 |
| T3 | 单词直译兜底与「词典义」视觉区分弱 | 不知道准不准、该不该信 |
| T4 | custom 与 online 同库混存，缓存膨胀/覆盖边界需更清晰策略 | 清缓存误伤、备份体积、旧烂译长期占位 |
| T5 | 无 rank 的词永不自动标注，只能手动选词；与「词库没有」体验割裂 | 页上明明有难词，却没有虚线 |
| T6 | 选词仅单 token；连字符、缩写、屈折/专名/拼写变体弱 | 选中后没反应或查错形 |
| T7 | 联网延迟串行瀑布流，最坏路径多次 8s 级超时叠加风险 | 一直「正在联网查询」 |
| T8 | 重试成功后不会主动回填打开中的 tooltip；用户不知队列已好 | 队列绿了，卡片还是失败 |
| T9 | 释义质量无轻量反馈闭环（改释义有，但「不准/太长」未驱动源策略） | 改了一次仍重复烂译 |
| T10 | 翻译相关页面场景：安全模式/仅手动/暂停/iframe 下查词可达性不一 | 「这页用不了查词」 |
| T11 | **标注词点不着 / 点了不触发**：模式互斥、残留选区、capture 抢事件、跳过过宽、遮挡层 | 「有下划线却点不开」「这页词都不能查」 |
| T12 | 无标注时的备用路径发现成本高 | 不知道 Alt / 右键 / popup 快查 |

外部约束备忘：MyMemory 匿名约 5000 字符/日（按 IP）；扩展侧请求共享用户网络出口，必须限流、冷却、失败切换，不能当无限免费 MT。

---

## 3. 设计原则（改动过滤器）

1. **本地优先，联网可选**：能离线解决绝不联网；联网必须用户意图或明确开关下的「补查」。
2. **有虚线必可达**：已标注词至少有一种可靠打开方式（click 或 hover+键盘）；打开失败时不得静默到「像坏了」。
3. **无虚线仍有路**：跳过区 / 无 rank / 仅手动模式下，选词、右键、popup 快查必须可用且可发现。
4. **短义优先**：卡片主行 ≤ 约 40 个汉字等价信息；多余进「更多/展开」，不堆主表面。
5. **来源可解释**：bundled / custom / online-词典 / online-机翻 四级可区分（文案对用户友好，技术细节可折叠）。
6. **失败可行动**：每个错误对应「重试 / 稍后再试 / 改释义 / 关联网 / 开设置」之一，不空喊失败。
7. **与兼容策略同向**：查词增强不得降低「不误伤页面」标准；复杂页降级为手动查词，而不是硬标。抢事件时优先「打开释义并阻止跳转」，避免为查词破坏整页脚本。
8. **最短有效 diff**：复用现有 `OnlineLookupResult`、`customDictionary`、`tooltip` 状态，不新造并行词库体系，除非 T4 证明必须拆分。
9. **YAGNI**：不做多语言目标语、不做用户自建 provider 插件市场（可选自有 endpoint 若做，单阶段可选）。

---

## 4. 用户场景矩阵（翻译视角）

| 场景 | 入口 | 期望 | 当前 | 优化方向 |
| --- | --- | --- | --- | --- |
| S1 标注词·本地有义 | hover/click/键盘 | 即时短义 + 认识/总是提醒 | 已有 | 质量与来源展示打磨 |
| S2 标注词·本地无义 | click/键盘 | 明确缺失 + 一键联网或自动一次 | 需再点联网 | T1：可选「缺词自动联网一次」或合并步骤 |
| S3 手动选词（Alt） | 选区 | 任意可见英文词可查 | 单 word 正则 | T6 |
| S4 右键菜单 | contextMenus | 与 S3 一致 | 已有 | 与选词规范化共用 |
| S5 popup 快查 | 输入框 | 离线→联网一致 | 已有 | 与 content 同源逻辑/文案 |
| S6 编辑区 | contenteditable 选词 | 不改 DOM，仍能释义 | 已有基线 | 回归 + 失败提示不挡输入 |
| S7 安全/仅手动/暂停 | 站点模式 | 暂停：不查；仅手动：可选词；安全：少标可查 | 部分 | T10 文案与可达性 |
| S8 联网失败 | tooltip/队列 | 原因 + 重试时间 + 手动再试 | 基线有 | T1/T7/T8 |
| S9 用户改释义 | 更多→改释义 | 永久 custom 优先 | 已有 | 禁止 online 覆盖 custom（T4） |
| S10 关联网 | 设置 | 全路径尊重开关 | 已有 | 缺词引导去设置保持一致 |
| **S11 链接内标注词** | click | 开释义，不跳转 | 冒泡阶段 suppress，capture 仍可能输 | **G：capture/pointer 加固** |
| **S12 残留选区** | click 标注词 | 单击仍应查词；真拖选不抢 | 任意非折叠选区直接放弃 | **G：选区策略收紧** |
| **S13 hover 设置下点击** | click | 也应打开（或触控强制 click） | click 直接 return | **G：混合触发** |
| **S14 可点卡片/列表行内正文** | 标注 | 正文可标可查，控件本身不标 | `onclick`/`tabindex` 祖先易整段跳过 | **G：交互面跳过收窄** |
| **S15 点了没反应时的备用** | Alt/右键/popup | 一次可发现 | 依赖用户已读 README | **G：空结果/诊断提示** |

---

## 5. 工作流划分（实施分期）

说明：每期结束应可单独交付、可测、可勾选。实施时**完成一项勾一项**，进度叙述写入 commit message（若用户要求提交），本文只维护 checkbox。

---

### 阶段 A — 释义链路可观测与正确性（基础）

目标：查词路径状态清晰，优先级无歧义，失败可行动。

- [x] **A1 解析优先级固化与单测**  
  - custom(custom) > custom(online cache) > bundled  
  - 明确：`source: 'custom'` 永不被 online 成功结果静默覆盖  
  - 单测覆盖同词三种来源

- [x] **A2 缺词主路径减步（默认行为决策）**  
  - 方案（推荐）：click/键盘/选词在本地未命中且联网开启时，**直接进入 loading→结果**，不再强制二次点击「联网查询」；hover 仍不自动联网  
  - 保留「已关闭联网」缺词态  
  - tooltip 仍展示「本地词库未收录，正在联网…」避免误以为卡死

- [x] **A3 错误文案与按钮对齐**  
  - 统一 `onlineLookupStatusMessage` 与 options 队列标签  
  - `queued: true` 时提示「已加入重试，可稍后在弹窗查看」  
  - not_found 不提供无意义狂点；提供「改释义」手写

- [x] **A4 来源展示分级**  
  - 本地词库 / 我的释义 / 在线词典 / 机器翻译  
  - `attribution.translationServiceLabel` 已有则露出；机翻兜底必须标「机器翻译，仅供参考」

**Done-means A**：相关 unit 绿；缺词 click 路径 1 次交互出结果或明确失败；custom 不被 online 覆盖有测。

---

### 阶段 G — 点得着、点得开（触发可靠性，高优先级）

目标：消灭「有下划线却点不开 / 这页词都不能查」的主因；保证备用路径可发现。  
与阶段 E（兼容降级）互补：G 管**触发与命中**，E 管**站点模式与复杂布局回归**。

#### G0 根因分类（实现与诊断共用）

| 根因码 | 现象 | 优先修复 |
| --- | --- | --- |
| TG-mode | 设置是悬停，用户在点 | 混合触发 / 触控强制 click |
| TG-selection | 残留选区导致 click 被吞 | 收紧 `hasActiveTextSelection` |
| TG-capture | 链接/卡片 capture 先跳转 | capture 或 pointerup 加固 |
| TG-skip | 交互面/噪声区过宽不标注 | 收窄 skip，正文仍可标 |
| TG-rank | 无 rank 永不标 | 不改为全量标；强化手动路径 |
| TG-overlay | 透明层挡住 hit-test | 诊断 + 手动路径；慎用全局 hit 劫持 |
| TG-silent | hover 无义静默 | 缺词提示或引导 click/联网 |
| TG-paused | 站点暂停/非 top-frame | 文案说明 + popup 快查 |

- [x] **G1 混合触发（推荐默认行为）**  
  - `lookupTrigger === 'hover'`：保留悬停打开；**click / 键盘仍调用 `lookupWord`**（用户明确点了就要有反馈）  
  - `lookupTrigger === 'click'`：行为不变（不因路过悬停误开，除非用户改回悬停）  
  - 触控 / `hover: none`：继续 `preferClickTriggerForPointer`；设置页说明「触控设备建议点击」  
  - 单测：hover 模式下 click 仍 showEntry

- [x] **G2 残留选区策略收紧**  
  - 现状：文档内任意非折叠选区 → 放弃 click 查词  
  - 改为（推荐）：仅当选区**与当前标注词相交**或选区长度明显 > 单词（真拖选）时让路；单击标注词产生的 caret/空选不拦截  
  - 可选：click 前若选区不包含该词则 `selection.removeAllRanges()` 再查（需测是否破坏用户复制意图——仅当选区与词无交时）  
  - 单测：残留他处选区仍可点词；拖选跨词不抢

- [x] **G3 链接 / 委托点击加固**  
  - 在标注词上使用 **capture: true** 的 click（或 `pointerup`）调用 `suppressPageClick` + `lookupWord`，降低祖先 capture/冒泡委托抢先导航  
  - 保持：链接内查词不跳转（已有 smoke/unit 基线，加固后回归）  
  - 不在 `document` 级全局 capture 劫持所有点击（避免误伤页面）

- [x] **G4 hover 缺词不再静默**  
  - hover 路径 `resolveEntry` 为空时：短暂提示「本地无释义，点击查询」或直接走与 click 相同的缺词/联网路径（与 A2 对齐；hover 是否自动联网仍遵循「hover 不自动联网」——只提示点击）  
  - 避免 mouseenter 刷屏：同一词同一锚点限频

- [x] **G5 交互面跳过收窄（「卡片里正文点不了」）**  
  - 审计 `isCustomInteractiveSurface`：`onclick` / `tabindex>=0` / `data-action` 落在**大块容器**时，改为只跳过「像控件的叶子」，或要求同时命中 button/chip/menu 等强信号  
  - **不**把 `a[href]` 当整段跳过（现状已特殊处理，保持）  
  - 增加反例单测：`<div onclick>` 包裹的段落正文仍可标注；真正的 chip/button 仍跳过  
  - 过宽 skip 的修改必须带兼容回归（E5），防止重新标坏导航/编辑器

- [x] **G6 备用路径可发现（T12）**  
  - popup 在 `annotatedWords === 0` 且页面有英文时：提示「可 Alt+选词 / 右键 / 上方快查」  
  - manual-only / safe 文案点明「仍可手动查词」  
  - 不新增第三种全局快捷键（除非现有 Alt 在系统上冲突——另开任务）

- [ ] **G7（可选）命中诊断**  
  - 开发/高级：复制诊断时增加「最近一次 click 未打开原因」枚举（TG-*），不含页面正文  
  - YAGNI：若 G1–G5 后反馈下降可砍

**Done-means G**：  
- hover 模式 click 可查有测；残留选区策略有测；链接内 capture 加固有测；大块 onclick 容器正文可标注有测；popup 零标注提示有测或快照。  
- 不引入 document 级全局 click 劫持。

---

### 阶段 B — 联网质量与延迟（核心）

目标：更快得到「像词典」的短中文义，降低串行超时体感。

- [x] **B1 短义压缩策略**  
  - 对机翻结果与多义拼接：取前 1–2 义、去末尾赘句、长度上限（实现放 pure function，便于单测）  
  - FreeDictionary 多中文义用 `；` 连接时截断到合理条数（现状已 slice(0,3)，评估是否改为 2 +「等」）

- [x] **B2 瀑布流时序优化**  
  - 单 provider 超时可配置（默认仍偏保守，如 5–6s 总预算而非每步 8s 叠满）  
  - 明确「总 deadline」：超时后尽快进下一源或机翻单词，避免用户空等  
  - 保持 in-flight 单飞与 cooldown

- [x] **B3 机翻输入选择**  
  - 优先译「短 definition / 第一义」而非整段 senses 拼接  
  - 单词直译仅在词典双源皆失败时使用；若直译结果 ≈ 原文或空，保持 not_found

- [x] **B4 Provider 健康与可测替身**  
  - 现有 `fetchImpl` 注入保持；补齐 dictionaryapi / 机翻 / cooldown / 总超时单测  
  - 记录失败 kind 供队列使用（已有则补缺口）

- [ ] **B5（可选）用户可见的「本次来源」**  
  - 成功结果 message 或 meta 一行：`在线词典` / `英文义+翻译` / `机器翻译`  
  - 不增加设置项噪音

**Done-means B**：模拟慢源/失败源的单测证明总耗时上界与短义截断；机翻兜底标记正确。

---

### 阶段 C — 缓存、队列与跨表面一致

目标：一次查到，处处可用；队列成功可感知。

- [x] **C1 联网成功缓存策略**  
  - 写入 online cache；TTL 或「用户改义后锁定」策略二选一写清并实现最小版  
  - 推荐最小版：无 TTL；`removeOnlineDictionaryEntries` 已有；增加「仅当 source!==custom 才 upsert online」

- [x] **C2 重试成功后的体验**  
  - 最小：队列项消失 + popup 摘要更新（已有基线则补测）  
  - 增强：若同词 tooltip 仍打开，可再次 resolve 本地 cache 刷新（可选，注意版本号）

- [x] **C3 popup 快查与 content 同源**  
  - 文案、错误、关联网行为对齐  
  - 快查成功同样写入 online cache（若尚未）

- [x] **C4 备份语义**  
  - 导入导出时 online cache 与 custom 计数说明保持；文档一句说清

**Done-means C**：content + popup 查同一生词均命中 cache；custom 保护单测；队列文案与 A3 一致。

---

### 阶段 D — 词形、选词与「页上难词」可达

目标：减少「选了没反应 / 页上不标但其实能查」。

- [x] **D1 选词规范化增强**  
  - 允许尾部标点剥离：`word,` `word.` `word)`  
  - 评估连字符：`state-of-the-art` 整词 vs 拆分（建议：整词先查，失败再拆主键）  
  - 保持忽略 URL/email（tokenize 已有）

- [x] **D2 Lemma / 屈折与联网**  
  - 离线 lemma 未命中时，联网前可尝试简单规则（复数 -s/-es、过去式 -ed、进行 -ing）生成候选，**先查本地再联网**，减少无效请求  
  - 规则纯函数 + 单测；不做完整形态学

- [x] **D3 无 rank 词的可达性**  
  - 不自动标注无 rank 词（避免刷屏与未知难度）  
  - 强化手动路径：选词/右键/popup 对无 rank 词照常离线+联网  
  - 文档与 popup 一句：「未划线的词可用 Alt 选词或右键查询」

- [x] **D4 专名与全大写**  
  - 规范化 lower 已有；避免把全大写缩写机翻成乱义：可选启发式（全大写且 ≤4 字母）优先 not_found 或提示「可能是缩写」  
  - 最小实现：直译结果与原文 case-insensitive 相同则 not_found

**Done-means D**：选词带标点可查；简单屈折先本地；无 rank 词手动路径单测/文档到位。

---

### 阶段 E — 与页面兼容的「查词」专项

目标：在兼容降级场景下，**释义能力仍达得到**，而不是只保证「不炸页」。

- [x] **E1 站点模式 × 查词矩阵单测/文档**  
  | 模式 | 自动标注 | 标注查词 | 手动选词 | 右键 |
  | --- | --- | --- | --- | --- |
  | auto | 是 | 是 | 是 | 是 |
  | low-density | 少 | 是 | 是 | 是 |
  | safe | 更少/更保守 | 是 | 是 | 是 |
  | manual-only | 否 | 否（无标） | 是 | 是 |
  | paused | 否 | 否 | 否 | 否或提示暂停 |

  - 对照实现修正不一致处

- [x] **E2 编辑器 / 代码 / PDF**  
  - 自动不标；Alt/菜单查词可用（编辑器已有基线）  
  - PDF.js 文本层不自动标；若选词困难，popup 快查作为主路径写进说明

- [x] **E3 Tooltip 与复杂布局**  
  - 查词 loading/失败/长义时的定位与 fixed 避让不回归  
  - 长义截断后高度变化触发 re-place（与现有 real-height place 对齐）

- [x] **E4 iframe / 非 top-frame**  
  - 默认不注入：顶层选词与 popup 仍是主路径  
  - 若未来 frame opt-in，查词消息与权限单独阶段，不本规划默认展开

- [x] **E5 兼容回归清单（翻译相关）**  
  - 从 `docs/analysis/page-compatibility-edge-cases.md` 抽「查词」子集：链接内 click、活动选区、编辑区选词、SPA 换页关 tooltip、orphan tooltip  
  - **叠加 G 回归**：capture 加固后链接不跳转、选区策略不破坏拖选复制、交互面收窄不回写导航/cookie 条  
  - 改动触及时跑对应 unit + 必要时 smoke

- [x] **E6 与 G 的分工验收**  
  - E 不重复实现 G 的触发逻辑；E 验收「模式与布局下 G 的行为仍成立」

**Done-means E**：模式矩阵行为与测试一致；兼容子集 + G 叠加回归无回退。

---

### 阶段 F — 质量闭环与文档（收尾）

- [ ] **F1 释义反馈**  
  - 「改释义」已有；可选增加「这条不准」仅本地计数（不上传），用于未来调权；若无明确收益可跳过（YAGNI）

- [x] **F2 README / PRIVACY**  
  - 更新联网链路说明、短义策略、用户可关联网、发送内容边界  
  - 与真实 `host_permissions` 一致

- [x] **F3 规划勾选与证据**  
  - 全部阶段 checkbox 勾完  
  - 保留 vitest/typecheck 日志路径或命令输出摘要（scratch 或 commit message）

**Done-means F**：文档与代码一致；全规划 checkbox 完成。

---

## 6. 建议实施顺序

```text
A1 → A4 → A3
  → G1 → G2 → G3 → G4 → G5 → G6   （点不着优先，与释义正确性紧耦合）
  → A2                               （缺词自动联网，依赖触发已可靠）
  → B1 → B3 → B2 → B4 → B5
  → C1 → C3 → C2 → C4
  → D1 → D2 → D4 → D3
  → E1 → E3 → E2 → E5 → E6 → E4(文档)
  → F2 → F3 （F1 / G7 可选）
```

依赖关系简述：

- A1/A3/A4 先稳住解析与文案，避免 G 只修「打开」却展示错义。  
- **G 紧接 A 前半**：用户体感「点不开」优先于机翻润色；A2 放在 G 后，避免自动联网绑在不可靠 click 上。  
- B/C 在触发与缺词路径稳定后做质量与缓存。  
- D 增强选词形态；E 做模式矩阵与兼容回归（含 G 叠加）。

---

## 7. 风险与非目标

| 风险 | 缓解 |
| --- | --- |
| 免费 API 不稳定/限流 | 多源、冷却、队列、可关联网；不承诺 100% 在线 |
| 自动联网被理解为「上传阅读内容」 | 仅主动查词；UI/PRIVACY 写清；hover 不联网 |
| 机翻质量差损害信任 | 短义截断 + 明确「机器翻译」标记 + 改释义 |
| 缓存污染 | custom 保护；可清空 online cache |
| 范围膨胀成整页翻译 | 阶段清单不含段落翻译；PR 审查拒绝 |
| 兼容性回退 | E5 清单；改 annotator/skip 规则必须带测 |
| capture 查词误伤页面按钮 | 仅挂在 `[data-qianci-word]`，禁止 document 全局劫持 |
| 收窄 skip 后导航/控件被标 | G5 反例+正例成对测；先测后放宽 |
| 清除选区破坏复制 | G2 仅在选区与词无交时处理 |

**明确不做（本规划）**：

- DeepL/官方 Google Cloud 等付费必选集成  
- 多语目标（如英→日）  
- 短语/整句翻译产品化  
- 云端账号词库  
- closed shadow / 默认 all_frames  
- document 级全局点击翻译（划词翻译产品化）

---

## 8. 验证策略

| 层级 | 内容 |
| --- | --- |
| 单测 | `online-dictionary`、`online-lookup-queue`、`dictionary`、`selection`/`tokenize`、`content-app` 缺词与**触发**路径、`tooltip`、`popup` 快查/零标注提示、`domCompatibility` 选区与 suppress、交互面 skip |
| 类型 | `npm run typecheck` |
| 构建 | 触及 manifest/打包时 `npm run build` |
| Smoke | 改触发/标注时：链接内 click、活动选区、必要时 SPA；G3/G5 改动优先 smoke |
| 手工（可选） | 真实难词联网；**新闻/卡片流/文档站**点标注词；关联网；限流模拟 |

每完成一阶段：只跑**直接受影响**的测试文件 + 必要时一次 typecheck；禁止无代码变更的重复全量刷测。

---

## 9. 与现有文档关系

| 文档 | 关系 |
| --- | --- |
| `docs/qianci-optimization-roadmap.md` | 总路线图；联网可靠、来源透明条目由**本文承接细化** |
| `docs/plan/2026-07-10-ux-experience-optimization-plan.md` | 操作体验；本文化「释义/联网」深度，不重复 popup 信息架构 |
| `docs/analysis/2026-07-10-interaction-ux-analysis.md` | 交互项 I1–I20 已完成；本文不重开交互表面，除非翻译链路必需 |
| `docs/analysis/page-compatibility-edge-cases.md` | 兼容基线；阶段 E/G 引用其查词与链接 click 子集 |
| `PRIVACY.md` / `README.md` | 阶段 F 同步；G6 可引用 README 手动查词说明 |

---

## 10. 确认后开工方式

1. 你确认本规划范围与阶段顺序，尤其：  
   - **G1**：hover 设置下 click 是否也要打开释义（推荐：要）  
   - **A2**：缺词是否自动联网（推荐：click/选词自动，hover 不自动）  
   - **C1**：online 缓存是否 TTL（推荐：最小策略，无 TTL + custom 保护）  
   - **G5**：是否允许收窄交互面 skip（可能略增标注量，需回归）  
2. 从 **A1** 起按第 6 节顺序实现，完成即勾选本文对应 `- [ ]` → `- [x]`。  
3. 不主动 commit/push，除非你明确要求。  
4. 全部 checkbox 完成后汇报：改动文件、验证命令、残留风险。

---

## 11. 附录：关键类型与错误码（实现备忘）

```ts
// OnlineLookupErrorKind
'not_found' | 'rate_limited' | 'service_unavailable'
| 'network_error' | 'timeout' | 'parse_error'

// DictionaryEntry.source
'bundled' | 'custom' | 'online'
```

推荐用户可见来源文案：

| source / 路径 | 文案 |
| --- | --- |
| bundled | 本地词库 |
| custom | 我的释义 |
| online + 词典 API | 在线词典 |
| online + 仅机翻单词 | 机器翻译（仅供参考） |
| online + 英文义再译 | 在线释义（经翻译） |

---

*本文为规划，不含代码改动。确认后按阶段 A → G → A2 → B…F 执行。*
