/**
 * Stage 16: Deterministic async request tracker.
 *
 * Separates "may this response be applied?" from "is a request still loading?".
 * Invalidating a request (because the user changed the input, switched round, or
 * closed the modal) abandons it AND releases the loading state, so the user is
 * never left with a permanently disabled button.
 */

export interface AsyncTracker {
  generation: number;
  inFlight: number;
}

export function createAsyncTracker(): AsyncTracker {
  return { generation: 0, inFlight: 0 };
}

/** Starts a request and returns its generation id. */
export function beginAsyncRequest(tracker: AsyncTracker): number {
  tracker.generation += 1;
  tracker.inFlight += 1;
  return tracker.generation;
}

/** Abandons all in-flight requests and releases loading immediately. */
export function invalidateAsyncRequests(tracker: AsyncTracker): void {
  tracker.generation += 1;
  tracker.inFlight = 0;
}

/**
 * Settles one request. `apply` is true only for the latest generation; `loading`
 * reflects whether any request is still in flight afterwards.
 */
export function settleAsyncRequest(
  tracker: AsyncTracker,
  requestId: number
): { apply: boolean; loading: boolean } {
  if (tracker.inFlight > 0) tracker.inFlight -= 1;
  return { apply: requestId === tracker.generation, loading: tracker.inFlight > 0 };
}
