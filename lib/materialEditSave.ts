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
  /**
   * How many linked-flag server reflections failed AFTER the body was saved.
   * The body itself is confirmed; only the follow-up review-flag mirroring
   * needs an explicit retry (the editor offers it, the next same-body save
   * re-runs it). Absent/zero means nothing is pending.
   */
  postprocessFailed?: number;
}

export interface MaterialEditSaveInput {
  server: ServerSaveStatus;
  serverError?: string;
  serverFallbackUsed?: boolean;
  local: LocalSaveStatus;
  localError?: string;
  /** The body was saved but its identity hash could not be persisted. */
  identityRecordFailed?: boolean;
  /** Linked-flag reflections that must succeed before the edit is complete. */
  postprocessFailed?: number;
}

export interface MaterialEditSaveOutcome {
  /** True only when every required save succeeded. */
  canClose: boolean;
  level: 'complete' | 'partial' | 'failed';
  succeeded: string[];
  failed: string[];
  /** Additional state details that must remain visible. */
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
  /** Intended title at save time (metadata-match proof for already_saved). */
  targetTitle?: string;
  /** Intended status at save time. */
  targetStatus?: string;
  /** Intended kind at save time. */
  targetKind?: string;
  /** Intended body-sync policy at save time. */
  targetSyncBody?: boolean;
}

export interface MaterialServerProbe {
  ok: boolean;
  hasBody?: boolean;
  hash?: string | null;
  /** Server row version at probe time (used for metadata-only writes). */
  version?: number;
  /** Pending job that currently owns the server slot, if any. */
  pendingJobId?: string | null;
  /** The job id that most recently activated the server row. */
  completedJobId?: string | null;
  /**
   * Metadata columns the server persists (missing fields arrive as undefined).
   * Compared field-by-field against the attempt's target; a missing server
   * field is insufficient evidence, never proof.
   */
  metadata?: {
    title?: string;
    status?: string;
    kind?: string;
    syncBody?: boolean;
  } | null;
}

function probeMetadataMatches(
  server: { title?: string; status?: string; kind?: string; syncBody?: boolean } | null | undefined,
  record: MaterialServerRetryRecord
): 'match' | 'mismatch' | 'unknown' {
  // A record that stored no target metadata cannot demand metadata proof;
  // only records WITH targets require the server to confirm them.
  const hasTargets =
    record.targetTitle !== undefined ||
    record.targetStatus !== undefined ||
    record.targetKind !== undefined ||
    record.targetSyncBody !== undefined;
  if (!hasTargets) return 'match';
  if (!server) return 'unknown';
  const pairs: Array<[string | boolean | undefined, string | boolean | undefined]> = [
    [server.title, record.targetTitle],
    [server.status, record.targetStatus],
    [server.kind, record.targetKind],
  ];
  for (const [serverValue, targetValue] of pairs) {
    if (targetValue === undefined) continue;
    if (serverValue === undefined) return 'unknown';
    if (serverValue !== targetValue) return 'mismatch';
  }
  if (record.targetSyncBody !== undefined) {
    if (server.syncBody === undefined) return 'unknown';
    if (server.syncBody !== record.targetSyncBody) return 'mismatch';
  }
  return 'match';
}

/**
 * Response-loss recovery rule. A retry of the SAME content asks the SERVER what
 * it actually stored, and distinguishes "unchanged since the attempt" from
 * "someone else changed it". A version bump or a matching hash alone never
 * proves THIS job completed: job id, base version, target body hash and target
 * metadata are checked TOGETHER.
 *  - no matching previous save record -> a normal new write may proceed,
 *  - server holds this job's exact state (hash + metadata + evidence of our
 *    job) -> 'already_saved' (never re-upload),
 *  - server still holds the pre-attempt state (baseHash/baseVersion) -> the
 *    earlier request did NOT land: 'retry_same_job' (safe to redo the SAME job),
 *  - anything else changed by another operation -> 'conflict',
 *  - lookup FAILED or required evidence missing -> 'unknown': never treated
 *    as "not saved yet",
 *  - metadata-only write (syncBody false): confirmed by the row VERSION plus
 *    matching metadata, never by a body hash or a version bump alone.
 */
export function evaluateMaterialServerRetry(
  record: MaterialServerRetryRecord | undefined,
  currentContentHash: string,
  server: MaterialServerProbe
): MaterialServerRetryVerdict {
  if (!record || record.contentHash !== currentContentHash) return 'no_record';
  // A lookup FAILURE is never interpreted as "not saved": the retry must stop.
  if (!server.ok) return 'unknown';

  // Another job owns the server slot right now: our claim cannot be verified.
  if (server.pendingJobId && record.jobId && server.pendingJobId !== record.jobId) {
    return 'conflict';
  }
  // Our own job is still staged on the server: safe to re-run the same job.
  if (server.pendingJobId && record.jobId && server.pendingJobId === record.jobId) {
    return 'retry_same_job';
  }

  // Metadata-only write (syncBody false): the row VERSION is the only signal,
  // and only together with matching metadata.
  if (record.syncBody === false) {
    if (server.version === undefined || record.baseVersion === undefined) return 'unknown';
    const meta = probeMetadataMatches(server.metadata ?? null, record);
    if (meta === 'unknown') return 'unknown';
    if (server.version > record.baseVersion) {
      if (meta === 'mismatch') return 'conflict';
      if (!record.jobId || !server.completedJobId) return 'unknown';
      return server.completedJobId === record.jobId ? 'already_saved' : 'conflict';
    }
    if (server.version === record.baseVersion) return 'retry_same_job';
    return 'conflict';
  }

  // Body-sync write (or legacy record without a syncBody flag): the body hash.
  if (server.hasBody && server.hash === currentContentHash) {
    const meta = probeMetadataMatches(server.metadata ?? null, record);
    if (meta === 'mismatch') return 'conflict';
    if (meta === 'unknown') return 'unknown';
    // Hash AND metadata match: completes only with evidence of OUR job — the
    // version advanced from our base, or the base already equaled the target.
    if (server.version !== undefined && record.baseVersion !== undefined) {
      if (server.version > record.baseVersion) {
        if (!record.jobId || !server.completedJobId) return 'unknown';
        return server.completedJobId === record.jobId ? 'already_saved' : 'conflict';
      }
      if (server.version === record.baseVersion) {
        return record.baseHash === currentContentHash ? 'already_saved' : 'unknown';
      }
      return 'conflict';
    }
    if (record.baseHash === currentContentHash) return 'already_saved';
    if (!record.jobId || !server.completedJobId) return 'unknown';
    return server.completedJobId === record.jobId ? 'already_saved' : 'conflict';
  }
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
    failed.push('서버 저장 정책과 원본 식별 정보 (필수 migration 미적용)');
    notes.push('서버 마이그레이션 9가 적용되지 않아 저장 정책과 원본 식별 정보는 서버에 저장되지 않았습니다.');
  }

  if (input.local === 'saved' && input.identityRecordFailed) {
    notes.push('본문은 이 기기에 저장됐지만 본문 식별 정보(해시)를 저장하지 못했습니다. 저장된 본문에서 재계산을 시도했으며 실패 시 "재검증 필요"로 표시해 재연결 때 오래된 해시로 거부하지 않습니다.');
  }

  if ((input.postprocessFailed ?? 0) > 0) {
    failed.push(`연관 검토 상태 반영 (${input.postprocessFailed}건 재시도 필요)`);
    notes.push(
      `본문은 저장됐지만 후처리가 남아 있습니다. 재시도는 같은 작업 ID로 서버 상태를 확인한 뒤 실패한 후처리만 실행합니다.`
    );
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
