import { createClient } from './supabase/server';
import { createAdminClient, hasAdminClientConfig } from './supabase/admin';

export type TrialTaskType = 'analyze_concepts' | 'generate_problems' | 'evaluate_answer';

export const DEFAULT_TRIAL_GRANTED_CREDITS = 1;
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
}

export interface TrialReservationResult {
  allowed: boolean;
  status?: 'reserved' | 'processing' | 'already_completed' | 'concurrent_in_progress';
  remaining?: number;
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
 * Retrieves the user's trial credits status or initializes 1 credit atomically if new.
 */
export async function getTrialCreditStatus(userId?: string): Promise<TrialCreditStatus> {
  if (!userId) {
    return { granted: DEFAULT_TRIAL_GRANTED_CREDITS, balance: 0, hasPersonalKey: false };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_or_create_trial_credits');
    if (error || !data || typeof data !== 'object') {
      return { granted: DEFAULT_TRIAL_GRANTED_CREDITS, balance: 0, hasPersonalKey: false };
    }
    const record = data as { granted?: number; balance?: number; hasPersonalKey?: boolean };
    return {
      granted: typeof record.granted === 'number' ? record.granted : DEFAULT_TRIAL_GRANTED_CREDITS,
      balance: typeof record.balance === 'number' ? record.balance : 0,
      hasPersonalKey: Boolean(record.hasPersonalKey),
    };
  } catch {
    return { granted: DEFAULT_TRIAL_GRANTED_CREDITS, balance: 0, hasPersonalKey: false };
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
    const client = hasAdminClientConfig() ? createAdminClient() : await createClient();
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
    };
  } catch (err) {
    return {
      allowed: false,
      errorCode: 'RESERVATION_NETWORK_ERROR',
      message: err instanceof Error ? err.message : '체험 크레딧 예약 통신 오류',
    };
  }
}

/**
 * Records AI output as result_ready before attempting DB persistence.
 */
export async function recordTrialResultReady(
  userId: string,
  taskId: string,
  result: unknown
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    const client = hasAdminClientConfig() ? createAdminClient() : await createClient();
    const { data, error } = await client.rpc('record_trial_result_ready', {
      p_task_id: taskId,
      p_result: result,
      p_user_id: userId,
    });
    if (error || !data || typeof data !== 'object') {
      return { success: false, error: '결과 보존 처리 중 오류가 발생했습니다.' };
    }
    const res = data as { success?: boolean; status?: string };
    return { success: Boolean(res.success), status: res.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '결과 보존 통신 오류' };
  }
}

/**
 * Settles a previously reserved trial credit after successful generation and persistence.
 * Service-role only execution.
 */
export async function settleTrialCredit(
  userId: string,
  taskId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    const client = hasAdminClientConfig() ? createAdminClient() : await createClient();
    const { data, error } = await client.rpc('settle_trial_credit', {
      p_task_id: taskId,
      p_user_id: userId,
    });
    if (error || !data || typeof data !== 'object') {
      return { success: false, error: '체험 크레딧 확정 중 오류가 발생했습니다.' };
    }
    const res = data as { success?: boolean; status?: string; message?: string };
    return { success: Boolean(res.success), status: res.status, error: res.message };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '체험 크레딧 확정 통신 오류' };
  }
}

/**
 * Releases/refunds a reserved trial credit back to the user balance on pre-generation failure.
 * Service-role only execution.
 */
export async function releaseTrialCredit(
  userId: string,
  taskId: string,
  reason?: string
): Promise<{ success: boolean; status?: string; remaining?: number; error?: string }> {
  try {
    const client = hasAdminClientConfig() ? createAdminClient() : await createClient();
    const { data, error } = await client.rpc('release_trial_credit', {
      p_task_id: taskId,
      p_reason: reason || 'cancelled_or_failed',
      p_user_id: userId,
    });
    if (error || !data || typeof data !== 'object') {
      return { success: false, error: '체험 크레딧 환급 중 오류가 발생했습니다.' };
    }
    const res = data as { success?: boolean; status?: string; remaining?: number; message?: string };
    return { success: Boolean(res.success), status: res.status, remaining: res.remaining, error: res.message };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : '체험 크레딧 환급 통신 오류' };
  }
}
