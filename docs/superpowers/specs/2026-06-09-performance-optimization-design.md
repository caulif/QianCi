# 潜词性能优化设计

日期：2026-06-09

## 目标

本轮优化让潜词在真实用户最常见路径中尽量不产生可感知卡顿：打开英文长文、滚动阅读、SPA 动态插入内容、划词或打开 tooltip。实现必须可验证，不能只依赖主观感受。

## 非目标

- 不重写整套 content app 架构。
- 不改变标注决策、词典内容、用户画像算法和联网查词 provider。
- 不扩大扩展权限，不新增隐私敏感采集。
- 不主动提交 git。

## 当前问题

`src/content/app.ts` 已有 8ms 扫描分片和 pending root 去重，这是好的基础。但仍有四个风险：

- 首次全页扫描按 DOM 队列顺序推进，长页面中当前视口内容不一定优先。
- 滚动、选词、鼠标进入标注词、点击查词时，后台扫描没有明确让步信号。
- 高频 mutation 页面只做 root 合并，没有区域冷却，可能持续触发扫描准备。
- 页面诊断只能看到最近一次扫描耗时，不能判断是否发生长片、队列积压或动态降频。

## 设计

### 1. 扫描调度让步

保留现有分片预算，新增用户交互让步窗口。发生 `scroll`、`selectionchange`、标注词 `mouseenter`、标注词 `click`、键盘打开 tooltip 时，扫描队列在短时间内延后下一片，让页面先处理用户操作。

让步必须是短窗口，不应导致扫描永远停住。后续切片仍由已有队列继续推进。

### 2. 视口优先扫描

扫描队列收集元素子节点时，对元素节点按可见性分为两类：

- 视口附近节点优先入队。
- 视口外节点延后入队。

这样长文首次打开时，当前阅读区域先可用，页面远端内容渐进处理。

### 3. 高频 mutation 降频

为 MutationObserver 增加轻量级 mutation 压力窗口：

- 记录短时间内 mutation 数量。
- 超过阈值后进入动态降频窗口。
- 降频期间延长扫描准备延迟，并在诊断里暴露 `dynamic-page`。

该策略只影响自动扫描，不影响手动划词查词。

### 4. 可观测指标

扩展 `PageDiagnostics`：

- `maxScanSliceDurationMs`：当前页面记录到的最大扫描片耗时。
- `queuedScanNodes`：当前等待处理的扫描节点数量。
- `deferredScanNodes`：因为视口外或让步被延后的节点数量。
- `throttledMutationBatches`：进入动态降频的 mutation 批次数。

popup 现有诊断可以继续只展示用户友好文案；这些字段主要用于测试、复制诊断和后续排查。

## Done Means

- 长页面首次扫描优先标注视口附近正文。
- 用户滚动或打开 tooltip 时，扫描下一片会短暂让步。
- 高频 mutation 会进入降频，不持续立即重扫。
- 页面诊断暴露最大单片耗时、队列积压、延后节点和降频次数。
- 相关单元测试先失败后通过。
- `npm run typecheck` 通过。
- 相关 vitest 通过。
- 若时间允许，`npm test` 完整通过。

## 验证命令

```powershell
npx vitest run tests/unit/content-app.test.ts tests/unit/content-compat-high-density-pages.test.ts
npm run typecheck
npm test
```

## 风险

- JSDOM 中视口和布局能力有限，单元测试需要用可控 `getBoundingClientRect` 模拟视口位置。
- 性能测试无法完全等价真实浏览器体感，因此要同时保留 smoke 压力页作为后续真实浏览器验证入口。
- `src/content/app.ts` 已超过 1000 行，本轮如果新增较多逻辑，需要拆出小模块，避免继续扩大主文件。
