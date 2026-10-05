'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadStoredAttempts,
  loadStoredConcepts,
  loadStoredStudyPlanItems,
  loadStoredStudyPlanSettings,
} from '../storage';
import { setStorageScope } from '../storageScope';
import { loadMockExams } from '../mockExam';
import type { Attempt, MockExamSession, ReviewEvent, StudyPlanItem } from '../types';
import {
  createAttempts,
  createMockExamSessions,
  createReviewEvents,
  createStudyPlanItems,
  listAttempts,
  listMockExamSessions,
  listReviewEvents,
  listStudyPlanItems,
  upsertStudyPlanSettings,
} from './historyRepository';

const USER_PREFIX = 'redcall_user_';
const MARKER_BASE = 'history_migration_v1';
const DECLINED_BASE = 'history_migration_declined_v1';

export interface HistoryMigrationState {
  imported: boolean;
  declined: boolean;
  hasLocalData: boolean;
}

export interface HistoryMigrationResult {
  ok: boolean;
  partial: boolean;
  uploaded: { attempts: number; events: number; planItems: number; mockExams: number };
  message: string;
}

function userBaseKey(userId: string, base: string): string {
  return `${USER_PREFIX}${encodeURIComponent(userId)}__${base}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // privacy mode
  }
  return null;
}

interface LocalHistory {
  attempts: Attempt[];
  events: Array<{ event: ReviewEvent; subjectId: string }>;
  planItems: StudyPlanItem[];
  mockExams: MockExamSession[];
}

function readLocal(userId: string): LocalHistory {
  setStorageScope({ kind: 'user', userId });
  const concepts = loadStoredConcepts();
  const events: Array<{ event: ReviewEvent; subjectId: string }> = [];
  for (const concept of concepts) {
    for (const event of concept.events ?? []) {
      events.push({ event, subjectId: concept.subjectId });
    }
  }
  return {
    attempts: loadStoredAttempts(),
    events,
    planItems: loadStoredStudyPlanItems(),
    mockExams: loadMockExams(),
  };
}

export function getHistoryMigrationState(userId: string): HistoryMigrationState {
  const storage = getStorage();
  if (!storage) return { imported: false, declined: false, hasLocalData: false };
  let imported = false;
  let declined = false;
  try {
    imported = storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null;
    declined = storage.getItem(userBaseKey(userId, DECLINED_BASE)) !== null;
  } catch {
    // ignore
  }
  let hasLocalData = false;
  try {
    const local = readLocal(userId);
    hasLocalData =
      local.attempts.length > 0 ||
      local.events.length > 0 ||
      local.planItems.length > 0 ||
      local.mockExams.length > 0;
  } catch {
    hasLocalData = true;
  }
  return { imported, declined, hasLocalData };
}

export function declineHistoryMigration(userId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(userBaseKey(userId, DECLINED_BASE), JSON.stringify({ declinedAt: new Date().toISOString() }));
  } catch {
    // best effort
  }
}

function writeMarker(storage: Storage, userId: string, payload: Record<string, unknown>): boolean {
  const key = userBaseKey(userId, MARKER_BASE);
  try {
    const serialized = JSON.stringify(payload);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

/**
 * Explicit, resumable one-time migration of local learning history. Local data
 * is kept until the server confirms + verifies; re-running only re-uploads
 * missing rows (idempotent upserts by id).
 */
export async function migrateLocalHistoryToCloud(
  userId: string,
  supabase: SupabaseClient
): Promise<HistoryMigrationResult> {
  const storage = getStorage();
  if (!storage) return { ok: false, partial: false, uploaded: { attempts: 0, events: 0, planItems: 0, mockExams: 0 }, message: '브라우저 로컬 저장소를 사용할 수 없습니다.' };

  try {
    if (storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null) {
      return { ok: true, partial: false, uploaded: { attempts: 0, events: 0, planItems: 0, mockExams: 0 }, message: '이미 학습 이력 이전이 완료되었습니다.' };
    }
  } catch {
    return { ok: false, partial: false, uploaded: { attempts: 0, events: 0, planItems: 0, mockExams: 0 }, message: '완료 표시를 확인하지 못했습니다.' };
  }

  const local = readLocal(userId);
  const empty =
    local.attempts.length === 0 &&
    local.events.length === 0 &&
    local.planItems.length === 0 &&
    local.mockExams.length === 0;

  if (empty) {
    const marked = writeMarker(storage, userId, { completed: true, completedAt: new Date().toISOString(), uploaded: { attempts: 0, events: 0, planItems: 0, mockExams: 0 } });
    return { ok: marked, partial: !marked, uploaded: { attempts: 0, events: 0, planItems: 0, mockExams: 0 }, message: marked ? '이전할 로컬 학습 이력이 없습니다.' : '완료 표시를 저장하지 못했습니다.' };
  }

  const uploaded = { attempts: 0, events: 0, planItems: 0, mockExams: 0 };
  const failures: string[] = [];

  // Insert-only: a retried migration never overwrites rows already on the
  // server (submitted exams, completed plan items, immutable attempts/events).
  if (local.attempts.length > 0) {
    const result = await createAttempts(supabase, local.attempts);
    if (result.ok) uploaded.attempts = result.data.length;
    else failures.push(`풀이: ${result.error}`);
  }
  if (local.events.length > 0 && failures.length === 0) {
    const result = await createReviewEvents(supabase, local.events);
    if (result.ok) uploaded.events = result.data.length;
    else failures.push(`복습: ${result.error}`);
  }
  if (local.planItems.length > 0 && failures.length === 0) {
    const result = await createStudyPlanItems(supabase, local.planItems);
    if (result.ok) uploaded.planItems = result.data.length;
    else failures.push(`계획: ${result.error}`);
  }
  if (local.mockExams.length > 0 && failures.length === 0) {
    const result = await createMockExamSessions(supabase, local.mockExams);
    if (result.ok) uploaded.mockExams = result.data.length;
    else failures.push(`모의시험: ${result.error}`);
  }

  if (failures.length > 0) {
    return { ok: false, partial: true, uploaded, message: `일부 이력 이전에 실패했습니다. 다시 시도하면 누락분만 이전됩니다. (${failures.join(' / ')})` };
  }

  const settings = loadStoredStudyPlanSettings();
  const settingsResult = await upsertStudyPlanSettings(supabase, settings);
  if (!settingsResult.ok) {
    return { ok: false, partial: true, uploaded, message: `학습 계획 설정 저장 실패: ${settingsResult.error}` };
  }

  // Verify by re-listing and comparing counts (server never returns empty for a
  // successful read; a read failure is reported, not treated as empty).
  const [serverAttempts, serverEvents, serverPlans, serverMock] = await Promise.all([
    listAttempts(supabase),
    listReviewEvents(supabase),
    listStudyPlanItems(supabase),
    listMockExamSessions(supabase),
  ]);
  const readError = [serverAttempts, serverEvents, serverPlans, serverMock].find((r) => !r.ok);
  if (readError && !readError.ok) {
    return { ok: false, partial: true, uploaded, message: `이전 검증 실패: ${readError.error}` };
  }

  const marked = writeMarker(storage, userId, { completed: true, completedAt: new Date().toISOString(), uploaded });
  if (!marked) {
    return { ok: false, partial: true, uploaded, message: '서버 이전은 완료됐지만 완료 표시를 저장하지 못했습니다. 다시 실행하면 검증 후 완료 표시를 다시 저장합니다.' };
  }

  return {
    ok: true,
    partial: false,
    uploaded,
    message: `학습 이력 이전 완료: 풀이 ${uploaded.attempts}건, 복습 ${uploaded.events}건, 계획 ${uploaded.planItems}건, 모의시험 ${uploaded.mockExams}건. 로컬 원본은 보존됩니다.`,
  };
}
