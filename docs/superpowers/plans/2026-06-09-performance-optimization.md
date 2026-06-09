# QianCi Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make QianCi's automatic annotation avoid user-visible stutter on common reading paths.

**Architecture:** Keep the existing content app behavior, but extract scan scheduling helpers into a focused module. The scanner will prioritize viewport-near nodes, yield after recent user interaction, throttle high-frequency mutation bursts, and expose diagnostics for verification.

**Tech Stack:** TypeScript, Vite, Vitest, JSDOM, Chrome extension content script APIs.

---

## File Structure

- Create `src/content/scanScheduler.ts`: pure helpers for interaction yielding, mutation throttling, scan delay, and child-node prioritization.
- Modify `src/content/app.ts`: wire scan scheduling helpers into existing queue, observer, diagnostics, and user-interaction handlers.
- Modify `src/core/messages.ts`: extend `PageDiagnostics` with performance metrics.
- Modify `tests/unit/content-app.test.ts`: add regression tests for yielding, mutation throttling, viewport priority, and diagnostics.
- Optionally modify `docs/progress/MASTER.md`: record verification evidence after implementation.

## Task 1: Diagnostics Contract

**Files:**
- Modify: `src/core/messages.ts`
- Test: `tests/unit/content-app.test.ts`

- [ ] **Step 1: Write the failing diagnostics test**

Add a test that calls `app.getDiagnostics()` after a scan and expects:

```ts
expect(diagnostics.maxScanSliceDurationMs).toBeGreaterThanOrEqual(diagnostics.lastScanDurationMs);
expect(diagnostics.queuedScanNodes).toBe(0);
expect(diagnostics.deferredScanNodes).toBeGreaterThanOrEqual(0);
expect(diagnostics.throttledMutationBatches).toBe(0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "reports scan performance diagnostics"
```

Expected: FAIL because the diagnostic fields do not exist.

- [ ] **Step 3: Extend `PageDiagnostics` and content diagnostics**

Add numeric fields to `PageDiagnostics` and return them from `getDiagnostics()`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "reports scan performance diagnostics"
```

Expected: PASS.

## Task 2: Scan Scheduler Helper

**Files:**
- Create: `src/content/scanScheduler.ts`
- Modify: `src/content/app.ts`
- Test: `tests/unit/content-app.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving:

```ts
expect(viewportWord).not.toBeNull();
expect(offscreenWord).toBeNull();
```

after only one scan slice, and:

```ts
expect(document.querySelectorAll('[data-qianci-word]')).toHaveLength(0);
```

immediately after scroll-triggered yielding.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "prioritizes viewport prose|yields scan continuation"
```

Expected: FAIL because current queue order does not prioritize viewport nodes and does not delay after interaction.

- [ ] **Step 3: Implement helper**

Create `scanScheduler.ts` with exported functions for:

- `createScanSchedulerState()`
- `markUserInteraction(state, now)`
- `shouldYieldForInteraction(state, now)`
- `scanDelayMs(state, baseDelayMs)`
- `prioritizeChildNodes(nodes, doc)`
- `recordMutationBatch(state, mutationCount, now)`

- [ ] **Step 4: Wire helper into app**

Use the helper in scan continuation, child enqueueing, scroll and selection listeners, and mutation observer scheduling.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "prioritizes viewport prose|yields scan continuation"
```

Expected: PASS.

## Task 3: Mutation Throttling

**Files:**
- Modify: `src/content/app.ts`
- Test: `tests/unit/content-app.test.ts`

- [ ] **Step 1: Write failing mutation test**

Create a test that appends many nodes quickly, flushes only the normal rescan delay, and expects `pendingScan` to remain true and `throttledMutationBatches` to increase.

- [ ] **Step 2: Run the mutation test to verify it fails**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "throttles high-frequency mutation"
```

Expected: FAIL because high-frequency mutation is not throttled.

- [ ] **Step 3: Implement throttled scan preparation**

Use the scheduler throttle state to extend scan preparation delay during high-frequency mutation bursts.

- [ ] **Step 4: Run the mutation test to verify it passes**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts -t "throttles high-frequency mutation"
```

Expected: PASS.

## Task 4: Focused Verification

**Files:**
- Modify: `docs/progress/MASTER.md` only if recording fresh evidence.

- [ ] **Step 1: Run focused content tests**

Run:

```powershell
npx vitest run tests/unit/content-app.test.ts tests/unit/content-compat-high-density-pages.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Inspect diff**

Run:

```powershell
git diff -- src/content/app.ts src/content/scanScheduler.ts src/core/messages.ts tests/unit/content-app.test.ts docs/superpowers/specs/2026-06-09-performance-optimization-design.md docs/superpowers/plans/2026-06-09-performance-optimization.md
```

Expected: Diff is limited to the planned performance work and documentation.
