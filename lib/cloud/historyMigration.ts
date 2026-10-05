'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadStoredAttempts,
  loadStoredConcepts,
  loadStoredProblems,
  loadStoredStudyPlanItems,
  loadStoredStudyPlanSettings,
  loadStoredSubjects,
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
  type ListPage,
} from './historyRepository';

const USER_PREFIX = 'redcall_user_';
const MARKER_BASE = 'history_migration_v1';
const DECLINED_BASE = 'history_migration_declined_v1';
const JOB_BASE = 'history_migration_job_v1';
const ORIGIN_BASE = 'history_migration_origin_v1';
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

export interface HistoryMigrationState {
  imported: boolean;
  declined: boolean;
  hasLocalData: boolean;
}

export interface MigrationMissingCounts {
  attempts: number;
  events: number;
  planItems: number;
  mockExams: number;
}

export interface HistoryMigrationResult {
  ok: boolean;
  partial: boolean;
  uploaded: { attempts: number; events: number; planItems: number; mockExams: number };
  /** Records that could not be found on the server after upload. */
  missing?: MigrationMissingCounts;
  /** Immutable records (attempts / review events) whose content differs. */
  conflicts?: number;
  /** Mutable records (plans / mock exams) where the server copy is newer (kept). */
  serverNewer?: number;
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

export interface MigrationSnapshot {
  attempts: Attempt[];
  events: Array<{ event: ReviewEvent; subjectId: string }>;
  planItems: StudyPlanItem[];
  mockExams: MockExamSession[];
  subjectIds: Set<string>;
  conceptIds: Set<string>;
  problemIds: Set<string>;
  /** When this snapshot was first captured (used to tell which copy is newer). */
  capturedAt?: string;
}

export interface ServerHistory {
  attempts: Attempt[];
  events: ReviewEvent[];
  planItems: StudyPlanItem[];
  mockExams: MockExamSession[];
}

export interface MigrationVerification {
  missing: MigrationMissingCounts;
  /** Immutable records (attempts / review events) whose content differs. */
  conflicts: string[];
  /** Records whose subject/concept/problem reference cannot be resolved. */
  dangling: string[];
  /** Mutable records where the server copy is newer and is preserved. */
  serverNewer: number;
}

function readLocal(userId: string): MigrationSnapshot {
  setStorageScope({ kind: 'user', userId });
  const concepts = loadStoredConcepts();
  const subjects = loadStoredSubjects();
  const problems = loadStoredProblems();
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
    subjectIds: new Set(subjects.map((s) => s.id)),
    conceptIds: new Set(concepts.map((c) => c.id)),
    problemIds: new Set(problems.map((p) => p.id)),
    capturedAt: new Date().toISOString(),
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

/** Records step-by-step progress so an interrupted migration can resume. */
function writeJob(storage: Storage, userId: string, job: Record<string, unknown>): void {
  try {
    storage.setItem(userBaseKey(userId, JOB_BASE), JSON.stringify({ ...job, updatedAt: new Date().toISOString() }));
  } catch {
    // best effort; resumability still holds via insert-only uploads + absent marker
  }
}

interface StoredOrigin {
  capturedAt: string;
  attempts: Attempt[];
  events: Array<{ event: ReviewEvent; subjectId: string }>;
  planItems: StudyPlanItem[];
  mockExams: MockExamSession[];
  subjectIds: string[];
  conceptIds: string[];
  problemIds: string[];
}

function serializeOrigin(snapshot: MigrationSnapshot): StoredOrigin {
  return {
    capturedAt: snapshot.capturedAt ?? new Date().toISOString(),
    attempts: snapshot.attempts,
    events: snapshot.events,
    planItems: snapshot.planItems,
    mockExams: snapshot.mockExams,
    subjectIds: [...snapshot.subjectIds],
    conceptIds: [...snapshot.conceptIds],
    problemIds: [...snapshot.problemIds],
  };
}

function deserializeOrigin(raw: StoredOrigin): MigrationSnapshot {
  return {
    attempts: raw.attempts ?? [],
    events: raw.events ?? [],
    planItems: raw.planItems ?? [],
    mockExams: raw.mockExams ?? [],
    subjectIds: new Set(raw.subjectIds ?? []),
    conceptIds: new Set(raw.conceptIds ?? []),
    problemIds: new Set(raw.problemIds ?? []),
    capturedAt: raw.capturedAt,
  };
}

/**
 * Returns the FIRST captured snapshot and preserves it across retries. A retry
 * verifies the original originals, NOT whatever the live cache currently holds
 * (which the server sync may have replaced in the meantime).
 */
function readOrigin(storage: Storage, userId: string): MigrationSnapshot {
  const key = userBaseKey(userId, ORIGIN_BASE);
  try {
    const raw = storage.getItem(key);
    if (raw) return deserializeOrigin(JSON.parse(raw) as StoredOrigin);
  } catch {
    // corrupted origin -> capture a fresh one below
  }
  const fresh = readLocal(userId);
  try {
    storage.setItem(key, JSON.stringify(serializeOrigin(fresh)));
  } catch {
    // best effort; the in-memory snapshot is still used for this run
  }
  return fresh;
}

type PageResult<T> = { ok: true; data: T[] } | { ok: false; error: string };

/**
 * Reads every page so verification never stops at the first 1000 rows.
 * Rows are deduped by id so a concurrent insert shifting an offset page can
 * never double-count a record (a genuinely skipped record is still caught as
 * `missing` and blocks completion).
 */
export async function collectAllPages<T extends { id: string }>(
  fetchPage: (page: ListPage) => Promise<PageResult<T>>
): Promise<PageResult<T>> {
  const seen = new Set<string>();
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const result = await fetchPage({ from, to: from + PAGE_SIZE - 1 });
    if (!result.ok) return result;
    for (const row of result.data) {
      if (row.id && seen.has(row.id)) continue;
      if (row.id) seen.add(row.id);
      all.push(row);
    }
    if (result.data.length < PAGE_SIZE) break;
  }
  return { ok: true, data: all };
}

const MOCK_STATUS_RANK: Record<string, number> = {
  in_progress: 0, submitted: 1, graded: 2, recorded: 3, abandoned: 4,
};
const PLAN_STATUS_RANK: Record<string, number> = { pending: 0, completed: 1, skipped: 2 };

function sorted(values?: string[]): string[] {
  return [...(values ?? [])].sort();
}

/**
 * Normalizes a timestamp for comparison. PostgREST returns `timestamptz` as
 * e.g. `2026-01-01T00:00:00+00:00` while local ISO strings end in `Z`; comparing
 * the raw strings would produce false conflicts.
 */
function timeMs(value?: string): number | string {
  if (typeof value !== 'string' || !value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : value;
}

/**
 * Which copy of a same-status mutable record is newer. Falls back to
 * "server newer" (non-blocking) when timestamps are unavailable.
 */
function contentVerdict(
  serverUpdatedAt: string | undefined,
  capturedAt: string | undefined
): 'server_newer' | 'local_newer' {
  if (!serverUpdatedAt || !capturedAt) return 'server_newer';
  const server = Date.parse(serverUpdatedAt);
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(server) || !Number.isFinite(captured)) return 'server_newer';
  return server >= captured ? 'server_newer' : 'local_newer';
}

/**
 * Immutable COMPLETION IDENTITY of a plan item: subject/concept/problem/round
 * only. `kind` is presentation metadata and may legitimately change without
 * losing the completion linkage, so it is intentionally NOT part of identity.
 */
function planImmutableSignature(p: StudyPlanItem): string {
  return JSON.stringify([p.subjectId, p.round ?? null, p.conceptId ?? null, p.problemId ?? null]);
}
function mockImmutableSignature(s: MockExamSession): string {
  return JSON.stringify([
    s.subjectId,
    s.durationMinutes,
    timeMs(s.createdAt),
    timeMs(s.endsAt),
    sorted(s.selectedConceptIds),
    sorted(s.selectedTypes),
    sorted((s.problems ?? []).map((p) => p.id)),
  ]);
}

// Mutable content used only to detect that the server copy is newer.
function attemptSignature(a: Attempt): string {
  return JSON.stringify([a.subjectId, a.conceptId, a.problemId, a.problemVersion ?? 1, timeMs(a.at), a.calculatedScore]);
}
function eventSignature(e: ReviewEvent): string {
  return JSON.stringify([e.conceptId, e.attemptId ?? null, e.kind, timeMs(e.at), e.resultScore]);
}
function planSignature(p: StudyPlanItem): string {
  return JSON.stringify([p.status, p.assignedDate, p.completedAttemptId ?? null]);
}
function mockSignature(s: MockExamSession): string {
  return JSON.stringify([s.status, s.answers ?? {}]);
}

/** Local records whose subject/concept/problem reference cannot be resolved. */
function danglingReferences(local: MigrationSnapshot): string[] {
  const dangling: string[] = [];
  for (const a of local.attempts) {
    if (!local.subjectIds.has(a.subjectId)) dangling.push(`attempt:${a.id}:subject`);
    if (!local.conceptIds.has(a.conceptId)) dangling.push(`attempt:${a.id}:concept`);
    if (!local.problemIds.has(a.problemId)) dangling.push(`attempt:${a.id}:problem`);
  }
  for (const { event, subjectId } of local.events) {
    if (!local.subjectIds.has(subjectId)) dangling.push(`event:${event.id}:subject`);
    if (!local.conceptIds.has(event.conceptId)) dangling.push(`event:${event.id}:concept`);
  }
  for (const p of local.planItems) {
    if (!local.subjectIds.has(p.subjectId)) dangling.push(`plan:${p.id}:subject`);
    if (p.conceptId && !local.conceptIds.has(p.conceptId)) dangling.push(`plan:${p.id}:concept`);
    if (p.problemId && !local.problemIds.has(p.problemId)) dangling.push(`plan:${p.id}:problem`);
  }
  for (const m of local.mockExams) {
    if (!local.subjectIds.has(m.subjectId)) dangling.push(`mock:${m.id}:subject`);
  }
  return dangling;
}

/**
 * Pure verification of an uploaded snapshot against the server records.
 * Missing ids, immutable content conflicts and dangling references are failures;
 * differing mutable records are reported as `serverNewer` (latest kept).
 */
export function verifyMigratedHistory(
  snapshot: MigrationSnapshot,
  server: ServerHistory
): MigrationVerification {
  const attemptMap = new Map(server.attempts.map((a) => [a.id, a]));
  const eventMap = new Map(server.events.map((e) => [e.id, e]));
  const planMap = new Map(server.planItems.map((p) => [p.id, p]));
  const mockMap = new Map(server.mockExams.map((m) => [m.id, m]));

  const missing: MigrationMissingCounts = {
    attempts: snapshot.attempts.filter((a) => !attemptMap.has(a.id)).length,
    events: snapshot.events.filter(({ event }) => !eventMap.has(event.id)).length,
    planItems: snapshot.planItems.filter((p) => !planMap.has(p.id)).length,
    mockExams: snapshot.mockExams.filter((m) => !mockMap.has(m.id)).length,
  };

  const conflicts: string[] = [];
  for (const a of snapshot.attempts) {
    const s = attemptMap.get(a.id);
    if (s && attemptSignature(s) !== attemptSignature(a)) conflicts.push(`attempt:${a.id}`);
  }
  for (const { event } of snapshot.events) {
    const s = eventMap.get(event.id);
    if (s && eventSignature(s) !== eventSignature(event)) conflicts.push(`event:${event.id}`);
  }

  let serverNewer = 0;
  for (const p of snapshot.planItems) {
    const s = planMap.get(p.id);
    if (!s) continue;
    // Immutable identity must match.
    if (planImmutableSignature(s) !== planImmutableSignature(p)) {
      conflicts.push(`plan:${p.id}:immutable`);
      continue;
    }
    // The server must not be BEHIND the local progress.
    const serverRank = PLAN_STATUS_RANK[s.status] ?? 0;
    const localRank = PLAN_STATUS_RANK[p.status] ?? 0;
    if (serverRank < localRank) {
      conflicts.push(`plan:${p.id}:behind`);
      continue;
    }
    // Same status but content differs: use the server updated-at to decide
    // whether the server copy is actually newer; an older differing server copy
    // means the local original was never represented -> conflict.
    if (planSignature(s) !== planSignature(p)) {
      if (contentVerdict(s.serverUpdatedAt, snapshot.capturedAt) === 'server_newer') serverNewer += 1;
      else conflicts.push(`plan:${p.id}:stale-server`);
    }
  }
  for (const m of snapshot.mockExams) {
    const s = mockMap.get(m.id);
    if (!s) continue;
    // Subject, duration, time window, selected scope and problem composition are
    // immutable; a difference is a conflict, never a "server newer" pass.
    if (mockImmutableSignature(s) !== mockImmutableSignature(m)) {
      conflicts.push(`mock:${m.id}:immutable`);
      continue;
    }
    // Server progress (status rank) must not lag the local record.
    const serverRank = MOCK_STATUS_RANK[s.status] ?? 0;
    const localRank = MOCK_STATUS_RANK[m.status] ?? 0;
    if (serverRank < localRank) {
      conflicts.push(`mock:${m.id}:behind`);
      continue;
    }
    if (mockSignature(s) !== mockSignature(m)) {
      if (contentVerdict(s.serverUpdatedAt, snapshot.capturedAt) === 'server_newer') serverNewer += 1;
      else conflicts.push(`mock:${m.id}:stale-server`);
    }
  }

  return { missing, conflicts, dangling: danglingReferences(snapshot), serverNewer };
}

/**
 * Explicit, resumable one-time migration of local learning history.
 *
 * The local snapshot is kept until the server CONFIRMS and VERIFIES it: every
 * record's id and core content is compared, and references are checked. A
 * successful re-read alone is never enough; missing / conflicting records leave
 * the completion marker unwritten so a retry resumes safely (insert-only).
 *
 * Changeable records (in-progress mock exams, plan items) keep the LATEST server
 * state; a differing server copy is reported as `serverNewer`, not overwritten.
 */
export async function migrateLocalHistoryToCloud(
  userId: string,
  supabase: SupabaseClient
): Promise<HistoryMigrationResult> {
  const storage = getStorage();
  const zero = { attempts: 0, events: 0, planItems: 0, mockExams: 0 };
  if (!storage) {
    return { ok: false, partial: false, uploaded: zero, message: '브라우저 로컬 저장소를 사용할 수 없습니다.' };
  }

  try {
    if (storage.getItem(userBaseKey(userId, MARKER_BASE)) !== null) {
      return { ok: true, partial: false, uploaded: zero, message: '이미 학습 이력 이전이 완료되었습니다.' };
    }
  } catch {
    return { ok: false, partial: false, uploaded: zero, message: '완료 표시를 확인하지 못했습니다.' };
  }

  // The snapshot is captured ONCE (on the first attempt) and preserved; every
  // retry verifies that original, never a cache the server may have replaced.
  const local = readOrigin(storage, userId);
  const empty =
    local.attempts.length === 0 &&
    local.events.length === 0 &&
    local.planItems.length === 0 &&
    local.mockExams.length === 0;

  if (empty) {
    const marked = writeMarker(storage, userId, { completed: true, completedAt: new Date().toISOString(), uploaded: zero });
    return { ok: marked, partial: !marked, uploaded: zero, message: marked ? '이전할 로컬 학습 이력이 없습니다.' : '완료 표시를 저장하지 못했습니다.' };
  }

  const uploaded = { attempts: 0, events: 0, planItems: 0, mockExams: 0 };
  const failures: string[] = [];
  writeJob(storage, userId, { startedAt: new Date().toISOString(), steps: { upload: 'running', verify: 'pending' } });

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
    writeJob(storage, userId, { startedAt: new Date().toISOString(), steps: { upload: 'failed', verify: 'pending' }, uploaded, failures });
    return { ok: false, partial: true, uploaded, message: `일부 이력 이전에 실패했습니다. 다시 시도하면 누락분만 이전됩니다. (${failures.join(' / ')})` };
  }

  const settings = loadStoredStudyPlanSettings();
  const settingsResult = await upsertStudyPlanSettings(supabase, settings);
  if (!settingsResult.ok) {
    writeJob(storage, userId, { startedAt: new Date().toISOString(), steps: { upload: 'failed', verify: 'pending' }, uploaded, failures: [`설정: ${settingsResult.error}`] });
    return { ok: false, partial: true, uploaded, message: `학습 계획 설정 저장 실패: ${settingsResult.error}` };
  }

  // --- Verification (paginated; a successful read alone is NOT completion) ---
  const [attemptsPage, eventsPage, plansPage, mockPage] = await Promise.all([
    collectAllPages((p) => listAttempts(supabase, p)),
    collectAllPages((p) => listReviewEvents(supabase, p)),
    collectAllPages((p) => listStudyPlanItems(supabase, p)),
    collectAllPages((p) => listMockExamSessions(supabase, p)),
  ]);
  const readError = [attemptsPage, eventsPage, plansPage, mockPage].find((r) => !r.ok);
  if (readError && !readError.ok) {
    writeJob(storage, userId, { startedAt: new Date().toISOString(), steps: { upload: 'done', verify: 'failed' }, uploaded, failures: [readError.error] });
    return { ok: false, partial: true, uploaded, message: `이전 검증 실패: ${readError.error}` };
  }

  const verification = verifyMigratedHistory(local, {
    attempts: attemptsPage.ok ? attemptsPage.data : [],
    events: eventsPage.ok ? eventsPage.data : [],
    planItems: plansPage.ok ? plansPage.data : [],
    mockExams: mockPage.ok ? mockPage.data : [],
  });
  const missingTotal =
    verification.missing.attempts +
    verification.missing.events +
    verification.missing.planItems +
    verification.missing.mockExams;

  if (missingTotal > 0 || verification.conflicts.length > 0 || verification.dangling.length > 0) {
    writeJob(storage, userId, {
      startedAt: new Date().toISOString(),
      steps: { upload: 'done', verify: 'failed' },
      uploaded,
      missing: verification.missing,
      conflicts: verification.conflicts.slice(0, 20),
      dangling: verification.dangling.slice(0, 20),
      serverNewer: verification.serverNewer,
    });
    const parts: string[] = [];
    if (missingTotal > 0) parts.push(`누락 ${missingTotal}건`);
    if (verification.conflicts.length > 0) parts.push(`내용 충돌 ${verification.conflicts.length}건`);
    if (verification.dangling.length > 0) parts.push(`참조 불일치 ${verification.dangling.length}건`);
    const samples = [...verification.conflicts, ...verification.dangling].slice(0, 5).join(', ');
    return {
      ok: false,
      partial: true,
      uploaded,
      missing: verification.missing,
      conflicts: verification.conflicts.length,
      serverNewer: verification.serverNewer,
      message: `이전 검증 실패: ${parts.join(', ')}. 완료 표시를 저장하지 않았습니다.${samples ? ` (${samples})` : ''}`,
    };
  }

  writeJob(storage, userId, {
    startedAt: new Date().toISOString(),
    steps: { upload: 'done', verify: 'done' },
    uploaded,
    missing: verification.missing,
    conflicts: [],
    serverNewer: verification.serverNewer,
  });

  const marked = writeMarker(storage, userId, { completed: true, completedAt: new Date().toISOString(), uploaded, serverNewer: verification.serverNewer });
  if (!marked) {
    return { ok: false, partial: true, uploaded, serverNewer: verification.serverNewer, message: '서버 이전은 검증됐지만 완료 표시를 저장하지 못했습니다. 다시 실행하면 검증 후 완료 표시를 다시 저장합니다.' };
  }

  return {
    ok: true,
    partial: false,
    uploaded,
    serverNewer: verification.serverNewer,
    message:
      `학습 이력 이전 완료: 풀이 ${uploaded.attempts}건, 복습 ${uploaded.events}건, 계획 ${uploaded.planItems}건, 모의시험 ${uploaded.mockExams}건. 로컬 원본은 보존됩니다.` +
      (verification.serverNewer > 0 ? ` 서버에서 더 최신인 기록 ${verification.serverNewer}건은 서버 상태를 유지했습니다.` : ''),
  };
}
