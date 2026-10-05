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
// Bulk upserts (migration / local mirror sync)
// ---------------------------------------------------------------------------

export async function upsertAttempts(supabase: SupabaseClient, attempts: Attempt[]): Promise<RepoResult<Attempt[]>> {
  try {
    if (attempts.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('attempts')
      .upsert(attempts.map(attemptToUpsert), { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as AttemptRow[]) ?? []).map(rowToAttempt));
  } catch (error) {
    return repoError(message(error, '풀이 기록을 저장하지 못했습니다.'));
  }
}

export async function upsertReviewEvents(
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

export async function upsertStudyPlanItems(
  supabase: SupabaseClient,
  items: StudyPlanItem[]
): Promise<RepoResult<StudyPlanItem[]>> {
  try {
    if (items.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('study_plan_items')
      .upsert(items.map(studyPlanItemToUpsert), { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as StudyPlanItemRow[]) ?? []).map(rowToStudyPlanItem));
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

export async function upsertMockExamSessions(
  supabase: SupabaseClient,
  sessions: MockExamSession[]
): Promise<RepoResult<MockExamSession[]>> {
  try {
    if (sessions.length === 0) return repoOk([]);
    const { data, error } = await supabase
      .from('mock_exam_sessions')
      .upsert(sessions.map(mockExamSessionToUpsert), { onConflict: 'id,user_id' })
      .select('*');
    if (error) return repoError(error.message);
    return repoOk(((data as MockExamSessionRow[]) ?? []).map(rowToMockExamSession));
  } catch (error) {
    return repoError(message(error, '모의시험 기록을 저장하지 못했습니다.'));
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
  if (raw.includes('CONCEPT_SCOPE_MISMATCH')) return 'concept_scope';
  if (raw.includes('PROBLEM_SCOPE_MISMATCH')) return 'problem_scope';
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
