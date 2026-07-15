# 潜词（QianCi）优化规划

日期：2026-07-09  
更新：2026-07-10（P0/P1 主 backlog 已落地，P3 探索项仍保留）  
版本基线：`0.1.1`（分支 `codex/optimization-roadmap`）  
状态：主优化项已实现；自定义端点 / PDF / storage.sync 等探索项仍待需求驱动

> 本文档基于**当前源码与测试现状**重新盘点，并吸收 Chrome MV3 / 页面性能 / 开源标注扩展的外部实践。  
> 旧文档 `docs/qianci-optimization-roadmap.md` 仍有参考价值，但其中部分“未完成”项已落地（例如 iframe 默认策略、重试队列 UI、继续提醒、Anki 导出）。**后续实施以本文为准。**

---

## 1. 项目理解（一句话到一层架构）

### 1.1 产品定位

潜词是面向中文用户的 **Manifest V3 浏览器阅读辅助扩展**：

- 在英文网页正文中**安静预判并标注**可能不认识的词
- 悬停/点击/`Alt+选词`/右键给出**简短中文释义**
- **本地优先**（词库 + 词频 + 用户画像），联网仅在用户主动补查时发生
- **不做**整页翻译、打卡平台、强通知或背词系统

核心承诺：低打扰、低占用、越用越准、可解释可撤销。

### 1.2 技术栈

| 层级 | 技术 |
| --- | --- |
| 构建 | Vite + `@crxjs/vite-plugin` |
| 语言 | TypeScript |
| 测试 | Vitest 单元测试 + Playwright 生产构建 smoke |
| 权限 | `storage` / `contextMenus` / `tabs` / `alarms` + `http(s)://*/*` host |

### 1.3 模块地图

```text
src/
  background/   service worker：右键查词、联网补查、重试 alarm
  content/      页面扫描、兼容规则、标注、tooltip、选区、性能调度
  core/         决策、画像、站点策略、消息类型、词形/词频
  storage/      profile / vocab / sitePolicy / customDictionary / retryQueue
  options/      设置页（引导、策略、词表、隐私、重试队列）
  popup/        站点模式、密度、诊断、重扫、队列摘要
  data/         生成后的本地词典包与 rank 索引
scripts/        词典构建、e2e smoke 夹具与断言
tests/unit/     42 个测试文件（含大量 page-compat 回归）
```

### 1.4 主数据流

```text
页面 DOM
  → content 扫描队列（视口优先 + 交互让步 + mutation 降频）
  → tokenize / rank / shouldAnnotateWord(profile)
  → 插入标注 wrapper（跳过噪声/控件/隐藏区）
  → tooltip（Shadow DOM 隔离）
  → 反馈写回 profile/vocab（认识 / 继续提醒 / 弱反馈跳过）
  → 本地未命中时用户主动 online-lookup
  → FreeDictionary → dictionaryapi.dev → MyMemory/Lingva
  → 失败入本地重试队列，alarm 退避重试
```

### 1.5 已验证能力快照（相对旧路线图）

以下能力在代码与 `docs/progress/MASTER.md` 中**已落地**，不再当作“待做”：

| 能力 | 证据位置 |
| --- | --- |
| 分片扫描 + 视口优先 + 交互让步 + mutation 降频 | `src/content/scanScheduler.ts`、`app.ts` |
| top-frame-only（默认不 `all_frames`） | `src/manifest.ts`、`framePolicy.ts` |
| 大量页面兼容（SPA/Shadow/PDF/GitHub/SERP/电商/同意浮层等） | `domCompatibility.ts` + 多个 `content-compat-*.test.ts` + smoke |
| 弱反馈透明化、继续提醒、撤销 | `profile.ts`、`tooltip.ts`、options 标注策略 |
| 联网重试队列摘要/详情/清空 | popup + options + `onlineLookupQueueStore.ts` |
| provider fallback（FreeDictionary → dictionaryapi.dev → 翻译） | `onlineDictionary.ts` |
| 学习回顾 + CSV/JSON/Anki 导出 | `options/main.ts` |
| 数据与隐私面板、清空缓存/站点设置 | options |
| 首次引导预设（安静/平衡/多提醒） | options |
| 页面诊断、重扫、脱敏复制 | popup + `PageDiagnostics` |

---

## 2. 外部依据（检索结论）

实施时应以这些约束为边界，而不是盲目扩功能。

### 2.1 Chrome Content Scripts / MV3

- 优先 `run_at: "document_idle"`，避免与页面首屏抢主线程。
- `all_frames`、`match_about_blank`、`match_origin_as_fallback` 会显著扩大注入面；**默认关闭、显式 opt-in** 更安全。
- Content script 与页面处于 isolated world，但**共享 DOM**；DOM 改写是兼容性风险的真正来源。
- Service worker 会休眠：alarm、队列、缓存必须可在启动时恢复。

参考：Chrome Content Scripts 文档。

### 2.2 主线程性能 / INP

- 长任务会伤害 Interaction to Next Paint；应把工作拆到约 50ms 以下，并在用户交互时让出主线程。
- 潜词已有约 8–12ms 片预算与交互让步；后续应补**可重复测量**的压力页与 `maxScanSliceDurationMs` 趋势，而不是只主观“感觉不卡”。
- 可评估 `scheduler.yield()` / `isInputPending()` 作为让步增强，但先证明现有 `setTimeout` 分片不足再上。

参考：web.dev Optimize long tasks、INP 相关指南。

### 2.3 开源标注扩展实践（Hypothesis / mark.js 等）

- **iframe 默认不进入，显式 opt-in**（Hypothesis 的 `enable-annotation` 思路与本项目 top-frame-only 一致）。
- UI 用 Shadow DOM 隔离；closed shadow root 不强行穿透。
- 排除选择器 / 根范围限定，比“全页硬扫”更稳。
- 点击命中结合 `composedPath()` / 自家 UI 排除，避免与页面控件抢事件。

参考：Hypothesis 文档与本仓库 `docs/analysis/page-compatibility-edge-cases.md`。

### 2.4 隐私与权限

- 最小权限、最小数据：默认只发送用户主动查的单词，不发整页。
- 诊断/日志/导出不得夹带 token、完整 URL path/query、选中正文、cookie。
- 自定义端点若做，必须高级设置 + HTTPS/localhost + token 遮罩。

---

## 3. 现状差距分析（按优先级）

### 3.1 产品体验缺口

| 缺口 | 现状 | 用户感知 |
| --- | --- | --- |
| 站点级自定义排除选择器 | 仅有 `.qianci-ignore` / `[data-qianci-ignore]` | 特定站点噪声区只能整站暂停或等官方规则 |
| 同源 iframe opt-in | 默认跳过 frame，无站点开关 | 课程页/嵌入文档“看起来没标注” |
| 站点模式偏粗 | 仅 `auto` / `manual-only` / `paused` | 缺“低密度/安全模式”中间态 |
| 自定义释义闭环不完整 | 有 `customDictionary` 存储与“释义不准”反馈，options **缺编辑入口** | tooltip 提示“去设置页改”，用户找不到 |
| 数据可迁移不完整 | 可导出 CSV/JSON/Anki，**缺 JSON 导入/冲突合并** | 换机/重装后学习数据难恢复 |
| 联网可关闭 | 无全局“关闭联网补查”开关 | 隐私敏感用户只能卸载 |
| 页面类型识别偏弱 | 诊断有 editor/form/code/dynamic 警告，无文章/搜索/课程等分类建议 | 0 标注时解释仍偏笼统 |

### 3.2 工程与可维护性缺口

| 缺口 | 现状 | 风险 |
| --- | --- | --- |
| 大文件超标 | `options/main.ts` ~1285 行（>1000）；`popup`/`tooltip`/`domCompatibility` 也偏大 | 后续改动冲突率高、审查困难 |
| 兼容规则膨胀 | `domCompatibility.ts` 集中大量选择器与场景 | 新增站点规则容易误伤正文 |
| 旧规划文档漂移 | `qianci-optimization-roadmap.md` 仍写 `all_frames: true` 等过时事实 | Agent/协作者误判优先级 |
| 性能验收偏定性 | 有调度指标字段，缺固定压力基线与回归门槛 | “优化”难证明不回退 |

### 3.3 明确非目标（本规划不承诺）

- 不做完整背词/打卡/排行榜
- 不做音视频 ASR 字幕识别
- 不绕过 closed Shadow DOM / 跨域 iframe 安全边界
- 不默认开启 `all_frames` 全站注入
- 不把设置页做成开发者控制台

---

## 4. 优化原则（决策过滤器）

1. **轻量优先**：tooltip 默认只保留单词 / 音标 / 中文 / 主操作；高级能力放折叠区、popup、options。
2. **可解释可撤销**：任何自动判断（弱反馈、安全模式、降频）必须能看见原因并恢复。
3. **本地优先**：联网失败不得拖垮本地标注与手动查词。
4. **兼容靠降级，不靠硬撑**：复杂页面先 manual-only / 跳过区域，而不是强行改 DOM。
5. **最短有效 diff**：优先复用现有 store / 诊断 / 扫描队列；不新造平行体系。
6. **可机械验收**：每个任务有命令 + 期望结果（Done-means）。
7. **文件体量守门**：新增逻辑优先拆模块，避免继续推高 `options/main.ts` / `app.ts`。

---

## 5. 分阶段路线图

### 阶段 0：规划与基线对齐（文档，本轮）

**目标**：单一规划源 + 正确现状基线。

- [x] 基于源码重写优化规划（本文）
- [ ] 后续实施时同步勾选 `docs/progress/MASTER.md` 中任务状态（不在计划文档写叙述进度）

**Done-means**：

- 存在 `docs/plan/2026-07-09-qianci-optimization-plan.md`
- 文中“已落地 / 待做”与 `manifest.ts`、`types.ts`、options/popup 行为一致

---

### 阶段 A：工程可维护性（P0，先拆后加）

> 目的：在继续堆兼容与功能前，降低大文件与误改风险。  
> 原则：行为不变，只拆文件；每个拆分任务只跑相关测试。

#### A1. 拆分 `options/main.ts`（最高优先）

- 建议拆出：
  - `options/renderOnboarding.ts`
  - `options/renderRetryQueue.ts`
  - `options/renderPrivacyPanel.ts`
  - `options/renderVocabPanel.ts`
  - `options/exportFormats.ts`（CSV/JSON/Anki 构建）
- 主文件只保留 `mountOptionsApp` 与状态装配

**Done-means**：

- `src/options/main.ts` ≤ 1000 行
- `npx vitest run tests/unit/options.test.ts` 通过
- `npm run typecheck` 通过

#### A2. 继续瘦身 content 层

- 将可访问名称引用、交互面检测、occlusion 采样、shadow discovery 从 `app.ts` / `domCompatibility.ts` 抽到专职 helper
- `mutationCompatibility` 保持“自家标注识别”单一职责

**Done-means**：

- `app.ts` 维持 ≤ 1000 行，且单函数 ≤ 100 行
- `npx vitest run tests/unit/content-app.test.ts tests/unit/content-compat*.test.ts` 相关文件通过

#### A3. 规划文档去漂移

- 在旧 `docs/qianci-optimization-roadmap.md` 顶部加“已归档/以新计划为准”的指向说明（实施时做，避免双源冲突）

**Done-means**：

- 读者打开旧文档 10 秒内能跳到本文

---

### 阶段 B：站点可控性闭环（P0/P1，用户立刻受益）

#### B1. 站点级自定义排除选择器

**需求**：

- 用户可为某 hostname 配置 CSS 选择器列表（如 `.toolbar`、`#sidebar`）
- 与 `.qianci-ignore` 叠加；非法选择器不抛未捕获异常
- popup 或 options 可增删；清空站点设置时一并清理

**数据模型建议**：

```ts
interface SitePolicy {
  mode: 'auto' | 'manual-only' | 'paused' | 'low-density' | 'safe';
  excludeSelectors?: string[];
  allowSameOriginFrames?: boolean;
  updatedAt: number;
}
```

**Done-means**：

- 单元测试：合法选择器跳过；非法选择器被忽略并记入诊断警告
- smoke：夹具中带自定义 exclude 的区域不标注，正文仍标注
- `npm run typecheck` + 相关 vitest 通过

#### B2. 站点模式扩展：`low-density` / `safe`

- `low-density`：沿用当前密度下限或额外系数，不改变跳过规则
- `safe`：更激进跳过（导航/侧栏/表格/高交互区），保留手动查词
- popup 三态扩展为清晰五态时，注意信息架构，避免按钮爆炸（可用二级菜单）

**Done-means**：

- `site-policy` / popup / content 测试覆盖新模式
- 切到 safe 后自动标注显著减少，手动查词仍可用

#### B3. 同源 iframe 显式 opt-in

**策略（对齐 Hypothesis）**：

1. 默认：不注入 frame（现状保持）
2. 仅当站点策略 `allowSameOriginFrames === true` 时，对**同源** frame 启用
3. 每个 frame 独立扫描预算；广告/隐藏/极小 frame 仍跳过
4. 诊断区分 top-frame / frame
5. **不**默认打开 `match_origin_as_fallback`；若评估课程页需要，单独立项

**Done-means**：

- manifest 策略有测试证明默认 top-frame-only 不回退
- opt-in 后同源 frame 可标注；跨域 frame 仍安全跳过
- e2e smoke 增加 frame 夹具

---

### 阶段 C：释义与数据所有权（P1）

#### C1. 自定义释义编辑闭环

- options 提供“自定义词条”列表：查看 / 编辑中文释义 / 删除
- tooltip「释义不准」后给出明确下一步（打开设置深链或内联轻量编辑）
- 查询优先级：**用户自定义 > 在线缓存 > 本地包 > 联网**

**Done-means**：

- 用户改释义后，同词再次打开 tooltip 立即显示自定义内容
- 清空在线缓存不删除 `source === 'custom'` 词条
- 相关 options / dictionary 测试通过

#### C2. 全局关闭联网补查

- profile 或独立设置：`onlineLookupEnabled: boolean`（默认 true）
- 关闭后：tooltip 不展示联网按钮；队列不再重试；本地能力不受影响

**Done-means**：

- 关闭后发起 online-lookup 被拒绝且 UI 有说明
- 打开后行为恢复

#### C3. JSON 导入与备份恢复

- 导出版本字段：`formatVersion`、`exportedAt`、词条、来源、统计
- 导入：schema 校验、冲突策略（跳过 / 覆盖 / 合并 familiar）
- 导入不接受 token/敏感字段；破坏性操作二次确认

**Done-means**：

- 导出 → 清空相关存储 → 导入 → 关键词状态恢复
- 错误文件给出可读错误，不损坏现有数据

---

### 阶段 D：联网可靠性增强（P1）

#### D1. Provider 熔断与请求合并

- 429 / 5xx / timeout 后 provider 级冷却
- 同一 word 并发点击合并为单飞请求
- service worker 启动补建 alarm（已有基础则补测试）

**Done-means**：

- `tests/unit/online-dictionary.test.ts` / `background.test.ts` 覆盖冷却与单飞
- 限流场景不会连打同一 provider

#### D2. 缓存命中归因

- tooltip / 词表区分：本地包 / 缓存 / 在线词典 / 机器翻译 / 用户自定义
- 缓存命中明确标“缓存结果”

**Done-means**：

- UI 文案测试或快照断言来源标签正确

#### D3. 自定义词典端点（高级，可后置）

- HTTPS 或 localhost；字段映射；测试连接
- token 遮罩，不进日志/诊断/普通导出

**Done-means**：

- 默认用户路径零感知；高级用户可测通自定义服务
- 安全审查：无 token 明文落盘到导出

---

### 阶段 E：性能与兼容 hardening（P1/P2）

#### E1. 可重复性能基线

- 固定压力夹具：5k / 10k 文本节点长文 + 高频 mutation SPA
- 断言：
  - 首屏附近优先出现标注
  - `maxScanSliceDurationMs` 有上限阈值（先观测再定硬阈值）
  - 滚动/打开 tooltip 期间扫描让步
- 诊断继续暴露 `queuedScanNodes` / `deferredScanNodes` / `throttledMutationBatches`

**Done-means**：

- smoke 或专用 perf harness 可本地一键跑
- 回归时有数字对比，不只靠体感

#### E2. 页面类型识别 → 建议动作

- 识别：article / search / form / code / course-like
- popup 0 标注时给出“最可能原因 + 一个按钮”
- 自动建议可拒绝；不静默改模式

**Done-means**：

- 夹具页分类正确；误判可手动覆盖

#### E3. 兼容矩阵收口（从 MASTER 下一步清单精选）

优先做**用户高频 × 现有规则可复用**的项：

1. 搜索结果：PAA 展开、无限滚动追加
2. GitHub：lazy diff 后 comment 仍可标
3. 组件库：Radix/Headless 关闭态清理
4. 同意浮层：Didomi/TrustArc 等精确选择器（禁止过宽 `*cookie*`）
5. 虚拟列表：更接近 react-window 的快速滚动池

**Done-means**：

- 每项至少 1 个 unit + 必要时 1 个 smoke 断言
- 不扩大误伤正文的默认跳过面（需对照正文回归）

---

### 阶段 F：体验抛光（P2）

#### F1. tooltip 信息架构

- 默认：词、音标、中文、认识/继续提醒/关闭
- 折叠：例句、词性、来源、释义反馈、撤销

#### F2. popup 状态卡

- 优先展示：是否在工作、模式、标注数、已检查段数、下一步

#### F3. 无障碍与深色页

- 键盘路径保持；焦点可见；tooltip 在深色背景下对比度可读

#### F4. 自适应站点建议

- 多次切 manual-only → 询问是否记住
- 高频 mutation → 建议 safe
- 几乎无英文 → 降低扫描频率  
- 全部可拒绝/可清空

---

### 阶段 G：探索项（P3，单独立项再做）

| 项 | 说明 | 前置条件 |
| --- | --- | --- |
| PDF 原生 viewer | 能力探测，不承诺 | 浏览器注入限制评估 |
| 课程跨域 iframe | 仅诊断+手动路径 | 不突破跨域 |
| storage.sync | 容量与隐私评估后再做 | 先完成 JSON 导入导出 |
| 短语级识别 | 不让 tooltip 变重 | 决策层与 UI 预算评估 |

---

## 6. 推荐实施顺序（可执行 backlog）

按“收益 / 风险 / 依赖”排序，建议严格串行前 4 项：

| 序号 | 任务 | 阶段 | 依赖 | 预估规模 |
| --- | --- | --- | --- | --- |
| 1 | 拆分 `options/main.ts` | A1 | 无 | 中 |
| 2 | 站点自定义 excludeSelectors | B1 | A1 更佳 | 中 |
| 3 | 自定义释义编辑闭环 | C1 | A1 | 中 |
| 4 | 全局关闭联网补查 | C2 | 无 | 小 |
| 5 | 站点模式 low-density / safe | B2 | B1 可选 | 中 |
| 6 | JSON 导入 | C3 | C1 可选 | 中 |
| 7 | Provider 熔断与单飞 | D1 | 无 | 中 |
| 8 | 性能压力基线 | E1 | 无 | 中 |
| 9 | 同源 iframe opt-in | B3 | B1/B2 | 大 |
| 10 | 页面类型建议 | E2 | E1 可选 | 中 |
| 11 | 兼容矩阵精选项 | E3 | 持续 | 持续小步 |
| 12 | 自定义端点 / sync / PDF | D3/G | 明确需求后再开 | 大 |

---

## 7. 验收总表（项目级 Done-means）

### 7.1 质量门禁（每个任务）

```powershell
npm run typecheck
# 只跑直接相关测试，例如：
npx vitest run tests/unit/<related>.test.ts
# 若改 content 兼容或 manifest，再：
npm run build
npm run test:e2e
```

完整回归仅在阶段收口或跨模块改动时使用：

```powershell
npm test
```

### 7.2 产品验收剧本（抽样）

1. **新用户**：3 步内完成引导；popup 能看出是否在工作。  
2. **标注太多**：popup 降密度或站点 low-density，页面不卡。  
3. **词消失了**：设置页 10 秒内找到弱反馈词并恢复/总是提醒。  
4. **释义不准**：能改成自定义释义并立即生效。  
5. **查词失败**：看到原因与队列，本地查词仍可用。  
6. **怪页面**：可切 manual-only/safe，可复制脱敏诊断。  
7. **换机**：JSON 导出再导入恢复学习数据。  

### 7.3 性能门槛（目标值）

| 指标 | 目标 |
| --- | --- |
| 单片扫描 | 尽量 8–12ms 让出；不制造 >50ms 长任务常态 |
| 首屏可用 | 视口附近优先于远端 |
| 交互优先 | 滚动/选词/tooltip 期间扫描让步 |
| 高频 mutation | 进入降频，诊断可见 |
| dispose 后 | 无残留 timer/observer/扫描任务 |

### 7.4 隐私门槛

- 默认仅主动查词时发送单词
- 诊断/导出无 token、无正文、无敏感 query
- 清空操作有范围说明与确认

---

## 8. 风险与取舍

| 风险 | 应对 |
| --- | --- |
| 功能变重，损害“安静”品牌 | 默认 UI 极简；高级能力折叠 |
| exclude 选择器被用户写炸页面 | 校验、try/catch、诊断警告、一键清空 |
| iframe opt-in 性能回退 | 同源限制 + 每 frame 预算 + 默认关闭 |
| 兼容选择器过宽误伤正文 | 每加规则必带正文回归测试 |
| 大文件继续膨胀 | 阶段 A 作为硬门槛，超 1000 行先拆再加 |
| 双规划文档冲突 | 本文为单一实施源；旧路线图仅历史参考 |

---

## 9. 与既有文档关系

| 文档 | 角色 |
| --- | --- |
| **本文** `docs/plan/2026-07-09-qianci-optimization-plan.md` | **当前优化实施单一规划源** |
| `docs/qianci-optimization-roadmap.md` | 2026-06-09 产品愿景与用户问题库；部分状态已过时 |
| `docs/analysis/page-compatibility-edge-cases.md` | 兼容边界与真实页面矩阵 |
| `docs/superpowers/specs/2026-06-09-performance-optimization-design.md` | 性能调度设计（多数已实现） |
| `docs/progress/MASTER.md` | 跨会话进度与验证证据（实施时更新） |

---

## 10. 建议的下一动作

若开始编码，推荐第一批只做：

1. **A1** 拆分 `options/main.ts`（为后续 UI 功能腾空间）  
2. **B1** 站点自定义排除选择器  
3. **C1** 自定义释义编辑闭环  

这三项共同特点：

- 直接提升用户可控性与信任
- 不扩大权限面
- 可在现有测试体系内闭环验收
- 符合“先可见化、再加深基础设施”的产品节奏

---

## 附录 A：关键源文件速查

| 主题 | 文件 |
| --- | --- |
| 标注决策 | `src/core/decision.ts` |
| 用户画像/弱反馈 | `src/core/profile.ts`、`src/core/types.ts` |
| 站点策略 | `src/core/sitePolicy.ts`、`src/storage/sitePolicyStore.ts` |
| 扫描调度 | `src/content/scanScheduler.ts` |
| 页面兼容 | `src/content/domCompatibility.ts` |
| Content 主流程 | `src/content/app.ts` |
| Frame 策略 | `src/content/framePolicy.ts`、`src/manifest.ts` |
| 联网查词 | `src/background/onlineDictionary.ts`、`worker.ts` |
| 自定义词 | `src/storage/customDictionaryStore.ts` |
| 设置/弹窗 | `src/options/main.ts`、`src/popup/main.ts` |

## 附录 B：命令速查

```powershell
npm install
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
npm test
```
