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
  status: 'saved' | 'not_required' | 'failed';
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

export function evaluateMaterialEditSave(input: MaterialEditSaveInput): MaterialEditSaveOutcome {
  const succeeded: string[] = [];
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
