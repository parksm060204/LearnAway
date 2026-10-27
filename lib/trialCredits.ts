import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from './supabase/server';
import { createAdminClient, hasAdminClientConfig } from './supabase/admin';

function getAdminOrMockClient(): SupabaseClient | null {
  if (hasAdminClientConfig()) {
    return createAdminClient();
  }
  const defaultTestClient = (globalThis as unknown as { __defaultFakeSupabaseClient?: SupabaseClient }).__defaultFakeSupabaseClient;
  if (defaultTestClient && (globalThis as unknown as { __disableFakeAdminClient?: boolean }).__disableFakeAdminClient !== true) {
    return defaultTestClient;
  }
  return null;
}

export type TrialTaskType =
  | 'analyze_concepts'
  | 'generate_problems'
  | 'evaluate_answer'
  | 'logic_questions'
  | 'transfer_problem'
  | 'review_problem_quality';

export const DEFAULT_TRIAL_GRANTED_CREDITS = 3; // General account default
export const DEFAULT_GUEST_TRIAL_GRANTED_CREDITS = 1; // Guest account default

export function getInitialGrantedCreditsForAccount(isGuest?: boolean): number {
  return isGuest ? DEFAULT_GUEST_TRIAL_GRANTED_CREDITS : DEFAULT_TRIAL_GRANTED_CREDITS;
}

export const MAX_TRIAL_ANALYZE_CHARS = 12000;
export const MAX_TRIAL_ANALYZE_CHUNKS = 2;
export const MAX_TRIAL_PROBLEMS_COUNT = 2;
export const MAX_TRIAL_PROBLEM_GEN_INPUT_CHARS = 15000;
export const MAX_TRIAL_EVAL_ANSWER_CHARS = 6000;
export const MAX_TRIAL_OUTPUT_TOKENS = 16000;
export const MAX_TRIAL_EXECUTION_TIMEOUT_MS = 40000;
export const MAX_TRIAL_TASK_RETRIES = 3;

export interface TrialCreditStatus {
  granted: number;
  balance: number;
  hasPersonalKey: boolean;
  isGuest?: boolean;
}

export interface TrialReservationResult {
  allowed: boolean;
  status?: 'reserved' | 'processing' | 'already_completed' | 'concurrent_in_progress';
  remaining?: number;
  leaseToken?: string;
  cachedResult?: unknown;
  errorCode?: string;
  message?: string;
}

export function isOperatorEmergencyStopped(env: Record<string, string | undefined> = process.env): boolean {
  const val = (env.OPERATOR_EMERGENCY_STOP || env.AI_OPERATOR_EMERGENCY_STOP || '').trim().toLowerCase();
  return val === 'true' || val === '1' || val === 'yes';
}

export function getOperatorDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.OPERATOR_DAILY_CALL_CAP || env.AI_OPERATOR_DAILY_CALL_CAP);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
}

/**
 * Validates trial input limits for Concept Analysis.
 */
export function validateTrialAnalyzeConceptsInput(
  totalChunks: number,
  markdownLength: number
): { ok: true } | { ok: false; error: string; errorCode: string } {
  if (totalChunks > MAX_TRIAL_ANALYZE_CHUNKS || markdownLength > MAX_TRIAL_ANALYZE_CHARS) {
    return {
      ok: false,
      errorCode: 'TRIAL_LIMIT_EXCEEDED',
      error: `체험 크레딧 분석은 최대 ${MAX_TRIAL_ANALYZE_CHUNKS}개 청크(약 12,000자)까지 지원됩니다. 자료 분량을 줄여 등록하거나, 설정에서 개인 API 키를 등록하면 분량 제한 없이 전체를 분석할 수 있습니다.`,
    };
  }
  return { ok: true };
}

export function validateTrialAnalysisInput(
  markdown: string,
  totalChunks: number
): { ok: true } | { ok: false; error: string; errorCode: string } {
  return validateTrialAnalyzeConceptsInput(totalChunks, (markdown || '').length);
}

/**
 * Validates trial input limits for Problem Generation.
 */
export function validateTrialProblemGenInput(
  problemCount: number,
  sourceLength: number
): { ok: true } | { ok: false; error: string; errorCode: string } {
  if (problemCount > MAX_TRIAL_PROBLEMS_COUNT || sourceLength > MAX_TRIAL_PROBLEM_GEN_INPUT_CHARS) {
    return {
      ok: false,
      errorCode: 'TRIAL_LIMIT_EXCEEDED',
      error: `체험 크레딧 문제 출제는 최대 ${MAX_TRIAL_PROBLEMS_COUNT}문항, 원문 길이 15,000자까지 지원됩니다. 범위를 줄이거나 설정에서 개인 API 키를 등록해 주세요.`,
    };
  }
  return { ok: true };
}

export const validateTrialGenerateProblemsInput = validateTrialProblemGenInput;

/**
 * Validates trial input limits for Answer Evaluation.
 */
export function validateTrialEvaluateAnswerInput(
  userAnswer: string,
  isMockExam: boolean
): { ok: true } | { ok: false; error: string; errorCode: string } {
  if (isMockExam) {
    return {
      ok: false,
      errorCode: 'MOCK_EXAM_TRIAL_PROHIBITED',
      error: '모의시험은 여러 문항이 일괄 평가되므로 AI 체험 크레딧으로 이용할 수 없습니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.',
    };
  }
  if (userAnswer.length > MAX_TRIAL_EVAL_ANSWER_CHARS) {
    return {
      ok: false,
      errorCode: 'TRIAL_LIMIT_EXCEEDED',
      error: `체험 크레딧 답안 평가는 최대 ${MAX_TRIAL_EVAL_ANSWER_CHARS}자까지 지원됩니다. 요약하여 입력하거나 설정에서 개인 API 키를 등록해 주세요.`,
    };
  }
  return { ok: true };
}

/**
 * Retrieves the user's trial credits status or initializes tiered credits (guest = 1, general = 3) atomically if new.
 */
export async function getTrialCreditStatus(userId?: string, isGuest?: boolean): Promise<TrialCreditStatus> {
  const defaultGranted = getInitialGrantedCreditsForAccount(isGuest);
  if (!userId) {
    return { granted: defaultGranted, balance: 0, hasPersonalKey: false, isGuest };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_or_create_trial_credits');
    if (error || !data || typeof data !== 'object') {
      return { granted: defaultGranted, balance: 0, hasPersonalKey: false, isGuest };
    }
    const record = data as { granted?: number; balance?: number; hasPersonalKey?: boolean; isGuest?: boolean };
    return {
      granted: typeof record.granted === 'number' ? record.granted : defaultGranted,
      balance: typeof record.balance === 'number' ? record.balance : 0,
      hasPersonalKey: Boolean(record.hasPersonalKey),
      isGuest: record.isGuest !== undefined ? Boolean(record.isGuest) : isGuest,
    };
  } catch {
    return { granted: defaultGranted, balance: 0, hasPersonalKey: false, isGuest };
  }
}

/**
 * Atomically reserves 1 trial credit for a bounded task.
 * Executed via server admin client (service_role) to protect reservation RPC from client tampering.
 */
export async function reserveTrialCredit(
  userId: string,
  taskId: string,
  taskType: TrialTaskType,
  inputIdentifier: string,
  dailyCap = getOperatorDailyCap()
): Promise<TrialReservationResult> {
  if (isOperatorEmergencyStopped()) {
    return {
      allowed: false,
      errorCode: 'OPERATOR_DISABLED',
      message: '운영자 AI 체험 서비스가 일시 점검 중입니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        allowed: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        message: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('reserve_trial_credit', {
      p_task_id: taskId,
      p_task_type: taskType,
      p_input_identifier: inputIdentifier,
      p_user_id: userId,
      p_daily_cap: dailyCap,
    });

    if (error || !data || typeof data !== 'object') {
      return {
        allowed: false,
        errorCode: 'RESERVATION_FAILED',
        message: '체험 크레딧 예약 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }

    const res = data as {
      allowed?: boolean;
      status?: 'reserved' | 'processing' | 'already_completed' | 'concurrent_in_progress';
      remaining?: number;
      lease_token?: string;
      cached_result?: unknown;
      error_code?: string;
      message?: string;
    };

    if (res.status === 'already_completed') {
      return {
        allowed: false,
        status: 'already_completed',
        remaining: res.remaining ?? 0,
        cachedResult: res.cached_result,
        message: '이미 완료된 작업의 결과가 보존되어 있습니다.',
      };
    }

    if (res.status === 'concurrent_in_progress') {
      return {
        allowed: false,
        status: 'concurrent_in_progress',
        errorCode: 'CONCURRENT_EXECUTION_BLOCKED',
        message: res.message || '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.',
      };
    }

    if (!res.allowed) {
      return {
        allowed: false,
        errorCode: res.error_code || 'INSUFFICIENT_CREDITS',
        remaining: res.remaining ?? 0,
        message: res.message || '체험 크레딧을 사용할 수 없습니다.',
      };
    }

    return {
      allowed: true,
      status: res.status || 'processing',
      remaining: res.remaining,
      leaseToken: res.lease_token,
    };
  } catch (err) {
    return {
      allowed: false,
      errorCode: 'RESERVATION_NETWORK_ERROR',
      message: err instanceof Error ? err.message : '체험 크레딧 예약 통신 오류',
    };
  }
}

export interface TaskRegistrationResult {
  allowed: boolean;
  status?: 'processing' | 'already_completed' | 'concurrent_in_progress' | 'reserved';
  dbStatus?: 'result_ready' | 'settled' | 'processing' | 'reserved' | 'released' | 'failed_refunded' | string;
  remaining?: number;
  leaseToken?: string;
  cachedResult?: unknown;
  errorCode?: string;
  message?: string;
  creditSource?: 'operator_trial' | 'personal_key';
  taskId?: string;
}

export function buildUserScopedTaskId(userId: string, prefix: string, inputIdentifier: string): string {
  const safeUser = (userId || 'anon').trim();
  const safePrefix = (prefix || 'task').trim();
  const safeHash = (inputIdentifier || 'empty').trim();
  return `${safePrefix}_${safeUser}_${safeHash}`;
}

export function buildLegacyTaskId(prefix: string, inputIdentifier: string): string {
  const safePrefix = (prefix || 'task').trim();
  const safeHash = (inputIdentifier || 'empty').trim();
  return `${safePrefix}_${safeHash}`;
}


/**
 * Atomically registers/verifies an AI task for both personal_key and operator_trial callers.
 * Enforces task ownership and input_identifier idempotency, blocking mismatched reuse or concurrent duplicates.
 */
export async function registerAiTask(
  userId: string,
  taskId: string,
  taskType: TrialTaskType,
  inputIdentifier: string,
  isPersonalKey = false,
  dailyCap = getOperatorDailyCap()
): Promise<TaskRegistrationResult> {
  if (!isPersonalKey && isOperatorEmergencyStopped()) {
    return {
      allowed: false,
      errorCode: 'OPERATOR_DISABLED',
      message: '운영자 AI 체험 서비스가 일시 점검 중입니다. 설정 > 내 AI API 연결에서 개인 API 키를 등록해 주세요.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        allowed: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        message: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('register_ai_task', {
      p_task_id: taskId,
      p_task_type: taskType,
      p_input_identifier: inputIdentifier,
      p_user_id: userId,
      p_is_personal_key: isPersonalKey,
      p_daily_cap: dailyCap,
    });

    if (error || !data || typeof data !== 'object') {
      const isMissingFunction = error && (
        error.code === '42883' ||
        error.code === 'PGRST202' ||
        /function .* does not exist/i.test(error.message || '')
      );
      return {
        allowed: false,
        errorCode: isMissingFunction ? 'MIGRATION_REQUIRED' : 'TASK_REGISTRATION_FAILED',
        message: isMissingFunction
          ? '필수 데이터베이스 마이그레이션(register_ai_task)이 적용되지 않았습니다. 관리자 조치가 필요합니다.'
          : (error?.message || '작업 등록 중 오류가 발생했습니다.'),
      };
    }

    const res = data as {
      allowed?: boolean;
      status?: 'processing' | 'already_completed' | 'concurrent_in_progress' | 'reserved';
      db_status?: string;
      remaining?: number;
      lease_token?: string;
      cached_result?: unknown;
      error_code?: string;
      code?: string;
      message?: string;
      credit_source?: 'operator_trial' | 'personal_key';
      task_id?: string;
    };

    if (typeof res.allowed !== 'boolean') {
      return {
        allowed: false,
        errorCode: 'TASK_REGISTRATION_INVALID_RESPONSE',
        message: '작업 등록 응답 구조가 유효하지 않습니다.',
      };
    }

    const errCode = res.error_code || res.code;
    const resolvedTaskId = typeof res.task_id === 'string' && res.task_id.trim() ? res.task_id.trim() : taskId;

    if (res.status === 'already_completed') {
      return {
        allowed: false,
        status: 'already_completed',
        dbStatus: res.db_status,
        remaining: res.remaining ?? 0,
        cachedResult: res.cached_result,
        leaseToken: res.lease_token,
        creditSource: res.credit_source,
        taskId: resolvedTaskId,
        message: res.message || '이미 완료된 작업의 결과가 보존되어 있습니다.',
      };
    }

    if (res.status === 'concurrent_in_progress') {
      return {
        allowed: false,
        status: 'concurrent_in_progress',
        dbStatus: res.db_status,
        errorCode: errCode || 'CONCURRENT_EXECUTION_BLOCKED',
        creditSource: res.credit_source,
        taskId: resolvedTaskId,
        message: res.message || '동일한 작업이 현재 실행 중입니다. 잠시 후 결과를 확인해 주세요.',
      };
    }

    if (!res.allowed) {
      return {
        allowed: false,
        errorCode: errCode || (isPersonalKey ? 'REGISTRATION_REJECTED' : 'INSUFFICIENT_CREDITS'),
        remaining: res.remaining ?? 0,
        creditSource: res.credit_source,
        taskId: resolvedTaskId,
        message: res.message || '작업을 실행할 수 없습니다.',
      };
    }

    if (!isPersonalKey && (!res.lease_token || typeof res.lease_token !== 'string')) {
      return {
        allowed: false,
        errorCode: 'LEASE_TOKEN_REQUIRED',
        message: '작업 실행 토큰이 발급되지 않아 AI 호출이 차단되었습니다.',
      };
    }

    return {
      allowed: true,
      status: res.status || 'processing',
      dbStatus: res.db_status || res.status,
      remaining: res.remaining,
      leaseToken: res.lease_token,
      creditSource: res.credit_source,
      taskId: resolvedTaskId,
    };
  } catch (err) {
    return {
      allowed: false,
      errorCode: 'TASK_REGISTRATION_NETWORK_ERROR',
      message: err instanceof Error ? err.message : '작업 등록 통신 오류',
    };
  }
}

/**
 * Checks whether the operator daily call limit has been reached today.
 */
export async function checkOperatorDailyUsage(dailyCap = getOperatorDailyCap()): Promise<boolean> {
  try {
    const client = getAdminOrMockClient();
    if (!client) return false;
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await client
      .from('operator_ai_daily_usage')
      .select('call_count')
      .eq('usage_date', today)
      .maybeSingle();
    if (error || !data) return false;
    return (data.call_count || 0) >= dailyCap;
  } catch {
    return false;
  }
}

export interface SavedTaskLookupResult {
  success: boolean;
  taskId?: string;
  status?: string;
  cachedResult?: unknown;
  leaseToken?: string;
  creditSource?: string;
  errorCode?: string;
  message?: string;
}

/**
 * Looks up server-preserved AI result for save retries (isSaveRetry: true / action: retry_save).
 * Strictly verifies ownership and input identifier without calling external AI.
 */
export async function lookupSavedTaskResult(
  userId: string,
  taskId: string,
  taskType?: TrialTaskType,
  inputIdentifier?: string,
  legacyInputIdentifier?: string
): Promise<SavedTaskLookupResult> {
  if (!taskId || !userId) {
    return {
      success: false,
      errorCode: 'INVALID_PARAMETERS',
      message: '작업 식별자 또는 사용자 정보가 누락되었습니다.',
    };
  }

  const doLookup = async (identifier?: string): Promise<SavedTaskLookupResult> => {
    try {
      const client = getAdminOrMockClient();
      if (!client) {
        return {
          success: false,
          errorCode: 'ADMIN_CONFIG_REQUIRED',
          message: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
        };
      }
      const { data, error } = await client.rpc('lookup_saved_ai_task_result', {
        p_task_id: taskId,
        p_user_id: userId,
        p_task_type: taskType || null,
        p_input_identifier: identifier || null,
      });

      if (!error && data && typeof data === 'object') {
        const res = data as {
          success?: boolean;
          status?: string;
          cached_result?: unknown;
          lease_token?: string;
          credit_source?: string;
          task_id?: string;
          error_code?: string;
          message?: string;
        };
        if (res.success) {
          return {
            success: true,
            taskId: res.task_id || taskId,
            status: res.status,
            cachedResult: res.cached_result,
            leaseToken: res.lease_token,
            creditSource: res.credit_source,
          };
        }
        return {
          success: false,
          errorCode: res.error_code || 'LOOKUP_FAILED',
          message: res.message || '보존된 결과를 조회하지 못했습니다.',
        };
      }

      // Direct table query fallback if lookup_saved_ai_task_result RPC is not present
      const { data: row, error: rowErr } = await client
        .from('ai_trial_reservations')
        .select('*')
        .eq('task_id', taskId)
        .maybeSingle();

      if (rowErr || !row) {
        return {
          success: false,
          errorCode: 'TASK_NOT_FOUND',
          message: '저장 재시도할 기존 작업 기록을 찾을 수 없습니다.',
        };
      }

      if (row.user_id !== userId) {
        return {
          success: false,
          errorCode: 'TASK_OWNERSHIP_MISMATCH',
          message: '해당 작업에 대한 접근 권한이 없습니다.',
        };
      }

      if (taskType && row.task_type !== taskType) {
        return {
          success: false,
          errorCode: 'TASK_TYPE_MISMATCH',
          message: '작업 종류가 일치하지 않습니다.',
        };
      }

      if (identifier && row.input_identifier !== identifier) {
        return {
          success: false,
          errorCode: 'TASK_INPUT_MISMATCH',
          message: '동일한 작업 ID에 서로 다른 입력이 전달되었습니다.',
        };
      }

      if (!row.cached_result) {
        return {
          success: false,
          errorCode: 'NO_SAVED_RESULT',
          message: '서버에 보존된 AI 생성 결과가 없습니다. 새로운 작업으로 다시 요청해 주세요.',
        };
      }

      return {
        success: true,
        taskId: row.task_id || taskId,
        status: row.status,
        cachedResult: row.cached_result,
        leaseToken: row.lease_token,
        creditSource: row.credit_source,
      };
    } catch (err) {
      return {
        success: false,
        errorCode: 'LOOKUP_NETWORK_ERROR',
        message: err instanceof Error ? err.message : '보존된 결과 조회 통신 오류',
      };
    }
  };

  const primary = await doLookup(inputIdentifier);
  if (!primary.success && primary.errorCode === 'TASK_INPUT_MISMATCH' && legacyInputIdentifier && legacyInputIdentifier !== inputIdentifier) {
    const secondary = await doLookup(legacyInputIdentifier);
    if (secondary.success) {
      return secondary;
    }
  }
  return primary;
}

/**
 * Records AI output as result_ready before attempting DB persistence.
 * Validates leaseToken to prevent stale executions from overwriting state.
 */
export async function recordTrialResultReady(
  userId: string,
  taskId: string,
  result: unknown,
  leaseToken?: string
): Promise<{ success: boolean; status?: string; error?: string; errorCode?: string }> {
  const token = typeof leaseToken === 'string' ? leaseToken.trim() : '';
  if (!token) {
    return {
      success: false,
      errorCode: 'LEASE_TOKEN_REQUIRED',
      error: '유효한 실행 토큰(lease_token)이 필요합니다.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        success: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        error: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('record_trial_result_ready', {
      p_task_id: taskId,
      p_result: result,
      p_user_id: userId,
      p_lease_token: token,
    });
    if (error || !data || typeof data !== 'object') {
      return {
        success: false,
        errorCode: 'RECORD_RESULT_RPC_ERROR',
        error: error?.message || '결과 보존 처리 중 오류가 발생했습니다.',
      };
    }
    const res = data as { success?: boolean; status?: string; error?: string; error_code?: string; errorCode?: string; code?: string };
    const errCode = res.error_code || res.errorCode || res.code || (!res.success ? 'RECORD_RESULT_FAILED' : undefined);
    return {
      success: Boolean(res.success),
      status: res.status,
      error: res.error,
      errorCode: errCode,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'RECORD_RESULT_NETWORK_ERROR',
      error: err instanceof Error ? err.message : '결과 보존 통신 오류',
    };
  }
}

/**
 * Settles a previously reserved trial credit after successful generation and persistence.
 * Validates leaseToken to prevent stale executions from settling refunded/retried tasks.
 * Service-role only execution.
 */
export async function settleTrialCredit(
  userId: string,
  taskId: string,
  leaseToken?: string
): Promise<{ success: boolean; status?: string; error?: string; errorCode?: string }> {
  const token = typeof leaseToken === 'string' ? leaseToken.trim() : '';
  if (!token) {
    return {
      success: false,
      errorCode: 'LEASE_TOKEN_REQUIRED',
      error: '유효한 실행 토큰(lease_token)이 필요합니다.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        success: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        error: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('settle_trial_credit', {
      p_task_id: taskId,
      p_user_id: userId,
      p_lease_token: token,
    });
    if (error || !data || typeof data !== 'object') {
      return {
        success: false,
        errorCode: 'SETTLE_RPC_ERROR',
        error: error?.message || '체험 크레딧 확정 중 오류가 발생했습니다.',
      };
    }
    const res = data as { success?: boolean; status?: string; message?: string; error?: string; error_code?: string; errorCode?: string; code?: string };
    const errCode = res.error_code || res.errorCode || res.code || (!res.success ? 'SETTLE_FAILED' : undefined);
    return {
      success: Boolean(res.success),
      status: res.status,
      error: res.message || res.error,
      errorCode: errCode,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'SETTLE_NETWORK_ERROR',
      error: err instanceof Error ? err.message : '체험 크레딧 확정 통신 오류',
    };
  }
}

/**
 * Releases/refunds a reserved trial credit back to the user balance on pre-generation failure.
 * Validates leaseToken to prevent stale executions from double-refunding or mutating retried state.
 * Service-role only execution.
 */
export async function releaseTrialCredit(
  userId: string,
  taskId: string,
  reason?: string,
  leaseToken?: string
): Promise<{ success: boolean; status?: string; remaining?: number; error?: string; errorCode?: string }> {
  const token = typeof leaseToken === 'string' ? leaseToken.trim() : '';
  if (!token) {
    return {
      success: false,
      errorCode: 'LEASE_TOKEN_REQUIRED',
      error: '유효한 실행 토큰(lease_token)이 필요합니다.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        success: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        error: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('release_trial_credit', {
      p_task_id: taskId,
      p_reason: reason || 'cancelled_or_failed',
      p_user_id: userId,
      p_lease_token: token,
    });
    if (error || !data || typeof data !== 'object') {
      return {
        success: false,
        errorCode: 'RELEASE_RPC_ERROR',
        error: error?.message || '체험 크레딧 환급 중 오류가 발생했습니다.',
      };
    }
    const res = data as { success?: boolean; status?: string; remaining?: number; message?: string; error?: string; error_code?: string; errorCode?: string };
    const errCode = res.error_code || res.errorCode || (!res.success ? 'RELEASE_FAILED' : undefined);
    return {
      success: Boolean(res.success),
      status: res.status,
      remaining: res.remaining,
      error: res.message || res.error,
      errorCode: errCode,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'RELEASE_NETWORK_ERROR',
      error: err instanceof Error ? err.message : '체험 크레딧 환급 통신 오류',
    };
  }
}

/**
 * Clears active execution lease for intermediate chunk completion in multi-chunk tasks.
 * Preserves processing state while unblocking normal sequential progression to next chunk.
 */
export async function clearAiTaskLease(
  userId: string,
  taskId: string,
  leaseToken?: string
): Promise<{ success: boolean; status?: string; error?: string; errorCode?: string }> {
  const token = typeof leaseToken === 'string' ? leaseToken.trim() : '';
  if (!token) {
    return {
      success: false,
      errorCode: 'LEASE_TOKEN_REQUIRED',
      error: '유효한 실행 토큰(lease_token)이 필요합니다.',
    };
  }

  try {
    const client = getAdminOrMockClient();
    if (!client) {
      return {
        success: false,
        errorCode: 'ADMIN_CONFIG_REQUIRED',
        error: '서버 관리자 설정(SUPABASE_SERVICE_ROLE_KEY)이 필요합니다.',
      };
    }
    const { data, error } = await client.rpc('clear_ai_task_lease', {
      p_task_id: taskId,
      p_user_id: userId,
      p_lease_token: token,
    });
    if (error || !data || typeof data !== 'object') {
      return {
        success: false,
        errorCode: 'CLEAR_LEASE_RPC_ERROR',
        error: error?.message || '실행 토큰 해제 중 오류가 발생했습니다.',
      };
    }
    const res = data as { success?: boolean; status?: string; error?: string; error_code?: string; errorCode?: string };
    const errCode = res.error_code || res.errorCode || (!res.success ? 'CLEAR_LEASE_FAILED' : undefined);
    return {
      success: Boolean(res.success),
      status: res.status,
      error: res.error,
      errorCode: errCode,
    };
  } catch (err) {
    return {
      success: false,
      errorCode: 'CLEAR_LEASE_NETWORK_ERROR',
      error: err instanceof Error ? err.message : '실행 토큰 해제 통신 오류',
    };
  }
}

