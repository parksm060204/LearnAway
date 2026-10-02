/**
 * Stage 15: Pure guard deciding whether an async AI response may be applied.
 *
 * A response is applied only when the modal is still mounted, it belongs to the
 * latest request generation, it belongs to the still-active session/round, and
 * its input snapshot still matches the current input. Otherwise it is stale and
 * must be ignored so the newest user input is preserved.
 */

export interface ResponseGuardInput {
  mounted: boolean;
  requestId: number;
  latestRequestId: number;
  requestSessionId: string;
  activeSessionId: string;
  snapshotHash: string;
  currentHash: string;
}

export function shouldApplyResponse(input: ResponseGuardInput): boolean {
  return (
    input.mounted === true &&
    input.requestId === input.latestRequestId &&
    input.requestSessionId === input.activeSessionId &&
    input.snapshotHash === input.currentHash
  );
}
