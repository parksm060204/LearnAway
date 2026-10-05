import type { SupabaseClient } from '@supabase/supabase-js';
import type { Attempt, MockExamSession, ReviewEvent, StudyPlanItem, StudyPlanSettings } from '../types';
import {
  attemptToUpsert,
  mockExamSessionToUpsert,
  reviewEventToUpsert,
  rowToAttempt,
  rowToMockExamSession,
  rowToReviewEvent,
  rowToStudyPlanItem,
  settingsToPayload,
  studyPlanItemToUpsert,
} from './historyMappers';
import type {
  AttemptRow,
  MockExamSessionRow,
  ReviewEventRow,
  StudyPlanItemRow,
  StudyPlanSettingsRow,
} from './historyTypes';
import type { RepoResult } from './types';
import { repoError, repoOk } from './types';

function message(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

export interface AttemptSubmitOutcome {
  attemptId: string;
  attemptInserted: boolean;
  eventInserted: boolean;
  planStatus: string;
  conflictAttemptId?: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listAttempts(supabase: SupabaseClient): Promise<RepoResult<Attempt[]>> {
  try {
    const { data, error } = await supabase.from('attempts').select('*').order('at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as AttemptRow[]) ?? []).map(rowToAttempt));
  } catch (error) {
    return repoError(message(error, '풀이 기록을 불러오지 못했습니다.'));
  }
}

export async function listReviewEvents(supabase: SupabaseClient): Promise<RepoResult<ReviewEvent[]>> {
  try {
    const { data, error } = await supabase.from('review_events').select('*').order('at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as ReviewEventRow[]) ?? []).map(rowToReviewEvent));
  } catch (error) {
    return repoError(message(error, '복습 이벤트를 불러오지 못했습니다.'));
  }
}

export async function listStudyPlanItems(supabase: SupabaseClient): Promise<RepoResult<StudyPlanItem[]>> {
  try {
    const { data, error } = await supabase.from('study_plan_items').select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as StudyPlanItemRow[]) ?? []).map(rowToStudyPlanItem));
  } catch (error) {
    return repoError(message(error, '학습 계획을 불러오지 못했습니다.'));
  }
}

export async function getStudyPlanSettings(
  supabase: SupabaseClient
): Promise<RepoResult<StudyPlanSettings | null>> {
  try {
    const { data, error } = await supabase.from('study_plan_settings').select('*').maybeSingle();
    if (error) return repoError(error.message);
    const row = data as StudyPlanSettingsRow | null;
    return repoOk(row?.payload ? (row.payload as unknown as StudyPlanSettings) : null);
  } catch (error) {
    return repoError(message(error, '학습 계획 설정을 불러오지 못했습니다.'));
  }
}

export async function listMockExamSessions(supabase: SupabaseClient): Promise<RepoResult<MockExamSession[]>> {
  try {
    const { data, error } = await supabase
      .from('mock_exam_sessions')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return repoError(error.message);
    return repoOk(((data as MockExamSessionRow[]) ?? []).map(rowToMockExamSession));
  } catch (error) {
    return repoError(message(error, '모의시험 기록을 불러오지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Insert-only bulk writes (migration / local mirror sync)
//
// History rows are immutable (attempts / review events) or must never be
// reverted from a stale local copy (plan completion, submitted mock exams), so
// these use ON CONFLICT DO NOTHING. Existing server rows always win.
// ---------------------------------------------------------------------------

export async function createAttempts(supabase: SupabaseClient, attempts: Attempt[]): Promise<RepoResult<Attempt[]>> {
  try {
    if (attempts.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('attempts')
      .upsert(attempts.map(attemptToUpsert), { onConflict: 'id,user_id', ignoreDuplicates: true })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as AttemptRow[]) ?? []).map(rowToAttempt));
  } catch (error) {
    return repoError(message(error, '풀이 기록을 저장하지 못했습니다.'));
  }
}

export async function createReviewEvents(
  supabase: SupabaseClient,
  events: Array<{ event: ReviewEvent; subjectId: string }>
): Promise<RepoResult<ReviewEvent[]>> {
  try {
    if (events.length === 0) return repoOk([]);
    const rows = events.map(({ event, subjectId }) => reviewEventToUpsert(event, subjectId));
    const { data, error } = await supabase
      .from('review_events')
      .upsert(rows, { onConflict: 'id,user_id', ignoreDuplicates: true })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as ReviewEventRow[]) ?? []).map(rowToReviewEvent));
  } catch (error) {
    return repoError(message(error, '복습 이벤트를 저장하지 못했습니다.'));
  }
}

export async function createStudyPlanItems(
  supabase: SupabaseClient,
  items: StudyPlanItem[]
): Promise<RepoResult<StudyPlanItem[]>> {
  try {
    if (items.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('study_plan_items')
      .upsert(items.map(studyPlanItemToUpsert), { onConflict: 'id,user_id', ignoreDuplicates: true })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as StudyPlanItemRow[]) ?? []).map(rowToStudyPlanItem));
  } catch (error) {
    return repoError(message(error, '학습 계획을 저장하지 못했습니다.'));
  }
}

export interface PlanItemConflict {
  ok: false;
  error: string;
  conflict: true;
  server: StudyPlanItem;
}

/**
 * Updates ONE plan item (postpone / skip / completion linkage) without ever
 * reverting a server-side completion. Returns a conflict when the server copy
 * is already completed and the local change is not, so stale local data can
 * never undo a completion recorded on another device.
 */
export async function saveStudyPlanItem(
  supabase: SupabaseClient,
  item: StudyPlanItem
): Promise<RepoResult<StudyPlanItem> | PlanItemConflict> {
  try {
    const existing = await supabase
      .from('study_plan_items')
      .select('*')
      .eq('id', item.id)
      .maybeSingle();
    if (existing.error) return repoError(existing.error.message);
    const serverRow = existing.data as StudyPlanItemRow | null;
    if (serverRow) {
      const server = rowToStudyPlanItem(serverRow);
      const serverCompleted = server.status === 'completed';
      const localCompleted = item.status === 'completed';
      if (serverCompleted && !localCompleted) {
        return { ok: false, error: 'PLAN_ITEM_COMPLETED_ON_SERVER', conflict: true, server };
      }
      if (
        localCompleted &&
        serverCompleted &&
        server.completedAttemptId &&
        server.completedAttemptId !== item.completedAttemptId
      ) {
        return { ok: false, error: 'PLAN_ITEM_COMPLETED_BY_OTHER', conflict: true, server };
      }
    }
    const { data, error } = await supabase
      .from('study_plan_items')
      .upsert(studyPlanItemToUpsert(item), { onConflict: 'id,user_id' })
      .select('*')
      .single();
    if (error) return repoError(error.message);
    return repoOk(rowToStudyPlanItem(data as StudyPlanItemRow));
  } catch (error) {
    return repoError(message(error, '학습 계획을 저장하지 못했습니다.'));
  }
}

export async function upsertStudyPlanSettings(
  supabase: SupabaseClient,
  settings: StudyPlanSettings
): Promise<RepoResult<StudyPlanSettings>> {
  try {
    const { error } = await supabase
      .from('study_plan_settings')
      .upsert({ payload: settingsToPayload(settings) }, { onConflict: 'user_id' });
    if (error) return repoError(error.message);
    return repoOk(settings);
  } catch (error) {
    return repoError(message(error, '학습 계획 설정을 저장하지 못했습니다.'));
  }
}

/**
 * Insert-only mock exam creation. Existing rows are never touched (a retried
 * migration or creation cannot reset a submitted exam's answers/version).
 */
export async function createMockExamSessions(
  supabase: SupabaseClient,
  sessions: MockExamSession[]
): Promise<RepoResult<MockExamSession[]>> {
  try {
    if (sessions.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('mock_exam_sessions')
      .upsert(sessions.map(mockExamSessionToUpsert), { onConflict: 'id,user_id', ignoreDuplicates: true })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as MockExamSessionRow[]) ?? []).map(rowToMockExamSession));
  } catch (error) {
    return repoError(message(error, '모의시험 기록을 저장하지 못했습니다.'));
  }
}

export async function getMockExamSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<RepoResult<MockExamSession | null>> {
  try {
    const { data, error } = await supabase
      .from('mock_exam_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return repoError(error.message);
    return repoOk(data ? rowToMockExamSession(data as MockExamSessionRow) : null);
  } catch (error) {
    return repoError(message(error, '모의시험 기록을 확인하지 못했습니다.'));
  }
}

// ---------------------------------------------------------------------------
// Transactional attempt submission + mock exam autosave/submit
// ---------------------------------------------------------------------------

function rpcCode(error: { message?: string } | null): string {
  const raw = error?.message ?? '';
  if (raw.includes('MOCK_SESSION_STALE')) return 'stale';
  if (raw.includes('MOCK_SESSION_LOCKED')) return 'locked';
  if (raw.includes('MOCK_SESSION_NOT_FOUND')) return 'missing';
  if (raw.includes('MOCK_SESSION_STATUS_REGRESSION')) return 'locked';
  if (raw.includes('CONCEPT_SCOPE_MISMATCH')) return 'concept_scope';
  if (raw.includes('PROBLEM_SCOPE_MISMATCH')) return 'problem_scope';
  if (raw.includes('PLAN_ROUND_REQUIRED')) return 'incomplete';
  if (raw.includes('ATTEMPT_INCOMPLETE')) return 'incomplete';
  return 'error';
}

/**
 * Atomically stores an attempt + its review event + optional plan completion.
 * Idempotent by attempt id, so retrying the same submission never duplicates.
 */
export async function submitAttempt(
  supabase: SupabaseClient,
  attempt: Attempt,
  event: ReviewEvent,
  planItemId?: string | null,
  planRound?: number | null
): Promise<RepoResult<AttemptSubmitOutcome>> {
  try {
    const { data, error } = await supabase.rpc('submit_attempt', {
      p_attempt: attempt as unknown as Record<string, unknown>,
      p_event: event as unknown as Record<string, unknown>,
      p_plan_item_id: planItemId ?? null,
      p_plan_round: planRound ?? null,
    });
    if (error) return repoError(`${rpcCode(error)}:${error.message}`);
    const result = (data ?? {}) as Record<string, unknown>;
    return repoOk({
      attemptId: String(result.attemptId ?? attempt.id),
      attemptInserted: Boolean(result.attemptInserted),
      eventInserted: Boolean(result.eventInserted),
      planStatus: String(result.planStatus ?? 'NOT_ATTEMPTED'),
      conflictAttemptId: result.conflictAttemptId ? String(result.conflictAttemptId) : undefined,
    });
  } catch (error) {
    return repoError(message(error, '풀이 기록 저장에 실패했습니다.'));
  }
}

export async function saveMockExamAnswers(
  supabase: SupabaseClient,
  session: MockExamSession,
  expectedVersion: number
): Promise<RepoResult<number>> {
  try {
    const { data, error } = await supabase.rpc('save_mock_exam_answers', {
      p_session_id: session.id,
      p_expected_version: expectedVersion,
      p_payload: session as unknown as Record<string, unknown>,
    });
    if (error) return repoError(`${rpcCode(error)}:${error.message}`);
    const result = (data ?? {}) as Record<string, unknown>;
    return repoOk(Number(result.version ?? expectedVersion + 1));
  } catch (error) {
    return repoError(message(error, '모의시험 답안을 저장하지 못했습니다.'));
  }
}

/**
 * Persists grading/recorded progress (evaluations, status, recordedAttemptIds)
 * WITHOUT ever moving the exam back to in_progress. Answers and the frozen
 * problem snapshot are preserved because the whole session is the payload.
 */
export async function saveMockExamGrading(
  supabase: SupabaseClient,
  session: MockExamSession,
  expectedVersion: number,
  status: 'submitted' | 'graded' | 'recorded'
): Promise<RepoResult<number>> {
  try {
    const { data, error } = await supabase.rpc('save_mock_exam_grading', {
      p_session_id: session.id,
      p_expected_version: expectedVersion,
      p_payload: session as unknown as Record<string, unknown>,
      p_status: status,
    });
    if (error) return repoError(`${rpcCode(error)}:${error.message}`);
    const result = (data ?? {}) as Record<string, unknown>;
    return repoOk(Number(result.version ?? expectedVersion + 1));
  } catch (error) {
    return repoError(message(error, '모의시험 채점 결과를 저장하지 못했습니다.'));
  }
}

export async function submitMockExam(
  supabase: SupabaseClient,
  session: MockExamSession,
  expectedVersion: number
): Promise<RepoResult<{ version: number; alreadySubmitted: boolean }>> {
  try {
    const { data, error } = await supabase.rpc('submit_mock_exam', {
      p_session_id: session.id,
      p_expected_version: expectedVersion,
      p_payload: session as unknown as Record<string, unknown>,
    });
    if (error) return repoError(`${rpcCode(error)}:${error.message}`);
    const result = (data ?? {}) as Record<string, unknown>;
    return repoOk({
      version: Number(result.version ?? expectedVersion + 1),
      alreadySubmitted: Boolean(result.alreadySubmitted),
    });
  } catch (error) {
    return repoError(message(error, '모의시험 제출에 실패했습니다.'));
  }
}

export async function getMockExamVersion(
  supabase: SupabaseClient,
  sessionId: string
): Promise<RepoResult<number>> {
  try {
    const { data, error } = await supabase
      .from('mock_exam_sessions')
      .select('version')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return repoError(error.message);
    if (!data) return repoError('MOCK_SESSION_NOT_FOUND');
    return repoOk(Number((data as { version?: number }).version ?? 1));
  } catch (error) {
    return repoError(message(error, '모의시험 버전을 확인하지 못했습니다.'));
  }
}
