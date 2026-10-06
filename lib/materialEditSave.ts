/**
 * Decides whether a material body edit may be closed after a save attempt.
 *
 * The device (IndexedDB) save and the server save are tracked separately.
 * Closing is only allowed once every save the material's policy REQUIRES has
 * succeeded; a server failure is never reported as completion.
 *
 * Order used by the editor: server first, then device. If the server write
 * fails the saved body on this device is deliberately left untouched
 * (`local: 'skipped'`) so a rejected edit never replaces the stored body.
 */

export type ServerSaveStatus =
  /** Server write confirmed in this call. */
  | 'saved'
  /** Server write was already confirmed for this exact content (retry). */
  | 'already_saved'
  /** Material lives only on this device: no server write is required. */
  | 'not_required'
  /** Server write failed or could not be confirmed. */
  | 'failed';

export type LocalSaveStatus = 'saved' | 'failed' | 'skipped';

export interface MaterialServerSaveResult {
  status: 'saved' | 'already_saved' | 'not_required' | 'failed';
  error?: string;
  /** Server saved, but migration 9 is missing so policy/hash columns were not stored. */
  fallbackUsed?: boolean;
}

export interface MaterialEditSaveInput {
  server: ServerSaveStatus;
  serverError?: string;
  serverFallbackUsed?: boolean;
  local: LocalSaveStatus;
  localError?: string;
  /** The body was saved but its identity hash could not be persisted. */
  identityRecordFailed?: boolean;
}

export interface MaterialEditSaveOutcome {
  /** True only when every required save succeeded. */
  canClose: boolean;
  level: 'complete' | 'partial' | 'failed';
  succeeded: string[];
  failed: string[];
  /** Notes that do not block closing but must not be hidden. */
  notes: string[];
  message: string;
}

export type MaterialServerRetryVerdict =
  | 'no_record'
  | 'already_saved'
  | 'retry_same_job'
  | 'conflict'
  | 'unknown';

/** Identity of the previous save attempt, persisted so a reload can recover it. */
export interface MaterialServerRetryRecord {
  /** materialContentHash of the content the previous attempt tried to write. */
  contentHash: string;
  /** Server body hash BEFORE the attempt (undefined for a legacy record). */
  baseHash?: string | null;
  /** Server row version BEFORE the attempt. */
  baseVersion?: number;
  /** Whether the policy syncs the body (false = metadata-only write). */
  syncBody?: boolean;
  /** Job id of the attempt, so the SAME job can be re-run safely. */
  jobId?: string | null;
}

export interface MaterialServerProbe {
  ok: boolean;
  hasBody?: boolean;
  hash?: string | null;
  /** Server row version at probe time (used for metadata-only writes). */
  version?: number;
}

/**
 * Response-loss recovery rule. A retry of the SAME content asks the SERVER what
 * it actually stored, and distinguishes "unchanged since the attempt" from
 * "someone else changed it":
 *  - no matching previous record -> a normal new write may proceed,
 *  - server already holds the target body -> 'already_saved' (never re-upload),
 *  - server still holds the pre-attempt body (baseHash) -> the earlier request
 *    did NOT land: 'retry_same_job' (safe to redo the SAME job),
 *  - server holds neither -> another operation changed it: 'conflict',
 *  - lookup FAILED -> 'unknown': never treated as "not saved yet",
 *  - metadata-only write (syncBody false): confirmed by the row VERSION, never
 *    by a body hash.
 */
export function evaluateMaterialServerRetry(
  record: MaterialServerRetryRecord | undefined,
  currentContentHash: string,
  server: MaterialServerProbe
): MaterialServerRetryVerdict {
  if (!record || record.contentHash !== currentContentHash) return 'no_record';
  // A lookup FAILURE is never interpreted as "not saved": the retry must stop.
  if (!server.ok) return 'unknown';

  // Metadata-only write: the server version is the only signal.
  if (record.syncBody === false) {
    if (server.version === undefined || record.baseVersion === undefined) return 'unknown';
    if (server.version > record.baseVersion) return 'already_saved';
    if (server.version === record.baseVersion) return 'retry_same_job';
    return 'conflict';
  }

  // Body-sync write: the server body hash is the signal.
  if (server.hasBody && server.hash === currentContentHash) return 'already_saved';
  if (server.hasBody) {
    if (record.baseHash !== undefined && server.hash === record.baseHash) return 'retry_same_job';
    return 'conflict';
  }
  // No body on the server.
  if (record.baseHash !== undefined && record.baseHash !== null) {
    // The server used to have a body and now has none: someone removed it.
    return 'conflict';
  }
  if (record.baseHash === undefined) {
    // Legacy record without a base: cannot prove it is unchanged.
    return 'no_record';
  }
  return 'retry_same_job';
}

export function evaluateMaterialEditSave(input: MaterialEditSaveInput): MaterialEditSaveOutcome {  const succeeded: string[] = [];
  const failed: string[] = [];
  const notes: string[] = [];

  if (input.local === 'saved') succeeded.push('이 기기 저장');
  else if (input.local === 'failed') {
    failed.push(`이 기기 저장${input.localError ? ` (${input.localError})` : ''}`);
  } else {
    notes.push('서버 저장이 끝나기 전이라 이 기기에 저장된 본문은 변경하지 않았습니다.');
  }

  const serverOk = input.server === 'saved' || input.server === 'already_saved';
  if (serverOk) succeeded.push('서버 저장');
  else if (input.server === 'failed') {
    failed.push(`서버 저장${input.serverError ? ` (${input.serverError})` : ''}`);
  }
  // 'not_required': neither success nor failure of the server is claimed.

  if (serverOk && input.serverFallbackUsed) {
    notes.push('서버 마이그레이션 9가 적용되지 않아 저장 정책과 원본 식별 정보는 서버에 저장되지 않았습니다.');
  }

  if (input.local === 'saved' && input.identityRecordFailed) {
    notes.push('본문은 이 기기에 저장됐지만 본문 식별 정보(해시)를 저장하지 못했습니다. 저장된 본문에서 재계산을 시도했으며 실패 시 "재검증 필요"로 표시해 재연결 때 오래된 해시로 거부하지 않습니다.');
  }

  const canClose = failed.length === 0;
  let level: MaterialEditSaveOutcome['level'];
  if (canClose) level = 'complete';
  else if (succeeded.length > 0) level = 'partial';
  else level = 'failed';

  let message: string;
  if (canClose) {
    message =
      input.server === 'not_required'
        ? '이 기기에 저장했습니다. (이 자료는 서버에 올리지 않는 로컬 자료입니다.)'
        : '저장을 완료했습니다.';
  } else if (level === 'partial') {
    message = `일부만 저장했습니다. 성공: ${succeeded.join(', ')} / 실패: ${failed.join(', ')}. 입력은 유지되며 다시 시도할 수 있습니다.`;
  } else {
    message = `저장하지 못했습니다. 실패: ${failed.join(', ')}. 입력은 유지되며 다시 시도할 수 있습니다.`;
  }
  return { canClose, level, succeeded, failed, notes, message };
}
