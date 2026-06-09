export interface ScanSchedulerState {
  lastUserInteractionAt: number;
  mutationWindowStartedAt: number;
  mutationCountInWindow: number;
  throttleUntil: number;
  throttledMutationBatches: number;
  deferredScanNodes: number;
}

const USER_INTERACTION_YIELD_MS = 8;
const MUTATION_WINDOW_MS = 120;
const MUTATION_THROTTLE_MS = 96;
const MUTATION_BATCH_THRESHOLD = 32;
const VIEWPORT_MARGIN_PX = 800;

/**
 * Creates mutable scan scheduling state for one content app instance.
 *
 * @returns Empty scheduling state with counters initialized.
 */
export function createScanSchedulerState(): ScanSchedulerState {
  return {
    lastUserInteractionAt: Number.NEGATIVE_INFINITY,
    mutationWindowStartedAt: 0,
    mutationCountInWindow: 0,
    throttleUntil: 0,
    throttledMutationBatches: 0,
    deferredScanNodes: 0
  };
}

/**
 * Records a user action that should take priority over automatic scanning.
 *
 * @param state Scheduler state for the current page.
 * @param now Current timestamp from performance.now.
 * @returns Nothing.
 */
export function markUserInteraction(state: ScanSchedulerState, now: number): void {
  state.lastUserInteractionAt = now;
}

/**
 * Clears a pending interaction yield when the user explicitly requests scanning.
 *
 * @param state Scheduler state for the current page.
 * @returns Nothing.
 */
export function clearUserInteractionYield(state: ScanSchedulerState): void {
  state.lastUserInteractionAt = Number.NEGATIVE_INFINITY;
}

/**
 * Checks whether the scanner should briefly yield to recent user input.
 *
 * @param state Scheduler state for the current page.
 * @param now Current timestamp from performance.now.
 * @returns True when scan work should be delayed.
 */
export function shouldYieldForInteraction(state: ScanSchedulerState, now: number): boolean {
  return now - state.lastUserInteractionAt < USER_INTERACTION_YIELD_MS;
}

/**
 * Calculates the next scan continuation delay after an interaction yield.
 *
 * @param state Scheduler state for the current page.
 * @param now Current timestamp from performance.now.
 * @returns Delay in milliseconds before scanning should resume.
 */
export function interactionYieldDelayMs(state: ScanSchedulerState, now: number): number {
  const elapsed = now - state.lastUserInteractionAt;
  return Math.max(1, Math.ceil(USER_INTERACTION_YIELD_MS - elapsed));
}

/**
 * Records a mutation batch and opens a throttle window when the page is changing rapidly.
 *
 * @param state Scheduler state for the current page.
 * @param mutationCount Number of mutation records in the current observer callback.
 * @param now Current timestamp from performance.now.
 * @returns Nothing.
 */
export function recordMutationBatch(state: ScanSchedulerState, mutationCount: number, now: number): void {
  if (now - state.mutationWindowStartedAt > MUTATION_WINDOW_MS) {
    state.mutationWindowStartedAt = now;
    state.mutationCountInWindow = 0;
  }

  state.mutationCountInWindow += mutationCount;
  if (state.mutationCountInWindow <= MUTATION_BATCH_THRESHOLD) {
    return;
  }

  const nextThrottleUntil = now + MUTATION_THROTTLE_MS;
  if (nextThrottleUntil > state.throttleUntil) {
    state.throttleUntil = nextThrottleUntil;
    state.throttledMutationBatches += 1;
  }
}

/**
 * Calculates scan preparation delay, including dynamic-page throttling.
 *
 * @param state Scheduler state for the current page.
 * @param baseDelayMs Normal debounce delay for scan preparation.
 * @param now Current timestamp from performance.now.
 * @returns Delay in milliseconds before scan preparation should run.
 */
export function scanPreparationDelayMs(state: ScanSchedulerState, baseDelayMs: number, now: number): number {
  return Math.max(baseDelayMs, Math.ceil(state.throttleUntil - now));
}

/**
 * Splits child nodes into viewport-near first and delayed offscreen nodes.
 *
 * @param nodes Child nodes collected from the DOM scanner.
 * @param doc Document used for viewport dimensions.
 * @returns Prioritized nodes and the number of delayed nodes.
 */
export function prioritizeChildNodes(nodes: Node[], doc: Document): { nodes: Node[]; deferredCount: number } {
  const nearNodes: Node[] = [];
  const farNodes: Node[] = [];

  for (const node of nodes) {
    if (isViewportNearNode(node, doc)) {
      nearNodes.push(node);
    } else {
      farNodes.push(node);
    }
  }

  return {
    nodes: [...nearNodes, ...farNodes],
    deferredCount: farNodes.length
  };
}

/**
 * Checks whether a node is close enough to the viewport to scan early.
 *
 * @param node Node considered for scan priority.
 * @param doc Document used for viewport dimensions.
 * @returns True when the node is near the current reading area.
 */
function isViewportNearNode(node: Node, doc: Document): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return true;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.bottom === 0) {
    return true;
  }

  const view = doc.defaultView ?? window;
  const viewportHeight = view.innerHeight || 0;
  return rect.bottom >= -VIEWPORT_MARGIN_PX && rect.top <= viewportHeight + VIEWPORT_MARGIN_PX;
}
