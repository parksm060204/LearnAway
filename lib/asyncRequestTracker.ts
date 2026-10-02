/**
 * Stage 16/17: Deterministic async request tracker.
 *
 * Tracks each request by id so that settling an OLD (invalidated) request can
 * never release the loading state of a NEWER request. Separates "may this
 * response be applied?" from "is any request still loading?".
 *
 * Aborting an invalidated request is best-effort; late responses are still
 * rejected via the generation check.
 */

export interface AsyncTracker {
  generation: number;
  active: Set<number>;
  controllers: Map<number, AbortController>;
}

export function createAsyncTracker(): AsyncTracker {
  return { generation: 0, active: new Set(), controllers: new Map() };
}

/** Starts a request and returns its unique generation id. */
export function beginAsyncRequest(tracker: AsyncTracker): number {
  tracker.generation += 1;
  tracker.active.add(tracker.generation);
  return tracker.generation;
}

/** Associates an AbortController with a request so it can be aborted on invalidate. */
export function registerAsyncController(
  tracker: AsyncTracker,
  requestId: number,
  controller: AbortController
): void {
  if (tracker.active.has(requestId)) {
    tracker.controllers.set(requestId, controller);
  }
}

/** Abandons all in-flight requests, aborts them, and releases loading immediately. */
export function invalidateAsyncRequests(tracker: AsyncTracker): void {
  tracker.generation += 1;
  tracker.active.clear();
  for (const controller of tracker.controllers.values()) {
    try {
      controller.abort();
    } catch {
      // ignore abort failures
    }
  }
  tracker.controllers.clear();
}

/**
 * Settles one request. Only a request that is still active affects loading, so an
 * invalidated request's late completion cannot clear a newer request's loading.
 * Double-settling the same request is a no-op.
 */
export function settleAsyncRequest(
  tracker: AsyncTracker,
  requestId: number
): { apply: boolean; loading: boolean; settled: boolean } {
  const settled = tracker.active.delete(requestId);
  tracker.controllers.delete(requestId);
  return {
    apply: requestId === tracker.generation,
    loading: tracker.active.size > 0,
    settled,
  };
}
