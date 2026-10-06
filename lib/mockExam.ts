import { Concept, MockExamSession, Problem, ProblemType, Subject, isProblemAvailableForPractice } from './types';
import { scopedStorageKey } from './storageScope';

const STORAGE_KEY = 'mock_exam_sessions_v1';
let inMemoryMockStore: MockExamSession[] = [];

export function loadMockExams(): MockExamSession[] {
  const key = scopedStorageKey(STORAGE_KEY);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(parsed) ? (parsed as MockExamSession[]) : [];
    }
    return inMemoryMockStore;
  } catch {
    return inMemoryMockStore;
  }
}

export function saveMockExam(session: MockExamSession): void {
  const key = scopedStorageKey(STORAGE_KEY);
  const existing = loadMockExams();
  const updated = [session, ...existing.filter((item) => item.id !== session.id)];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, JSON.stringify(updated));
    }
  } catch {}
  inMemoryMockStore = updated;
}

export function clearMockExams(): void {
  const key = scopedStorageKey(STORAGE_KEY);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(key);
    }
  } catch {}
  inMemoryMockStore = [];
}

/** Deterministic selection favors distinct topics and formats, then weak concepts. */
export function selectMockExamProblems(
  subject: Subject, concepts: Concept[], problems: Problem[],
  conceptIds: string[], types: ProblemType[], count: number
): Problem[] {
  const subjectConceptIds = new Set(concepts.filter((c) => c.subjectId === subject.id).map((c) => c.id));
  const selected = new Set(conceptIds.filter((id) => subjectConceptIds.has(id)));
  const allowedTypes = new Set(types);
  const scores = new Map(concepts.filter((c) => c.subjectId === subject.id).map((c) => [c.id, c.currentScore]));
  const pool = problems.filter((p) => p.subjectId === subject.id &&
    p.isApproved !== false && isProblemAvailableForPractice(p) &&
    allowedTypes.has(p.type) && p.conceptIds.length > 0 && p.conceptIds.every((id) => selected.has(id)));
  const result: Problem[] = [];
  const covered = new Set<string>();
  const usedTypes = new Set<ProblemType>();
  while (result.length < count && pool.length) {
    pool.sort((a, b) => {
      const priority = (p: Problem) => {
        const linked = p.conceptIds.filter((id) => selected.has(id));
        const newTopics = linked.filter((id) => !covered.has(id)).length;
        const weak = linked.length ? 100 - Math.min(...linked.map((id) => scores.get(id) ?? 100)) : 0;
        return (usedTypes.has(p.type) ? 0 : 10000) + newTopics * 1000 + weak;
      };
      return priority(b) - priority(a) || a.id.localeCompare(b.id);
    });
    const picked = pool.shift()!;
    result.push(structuredClone(picked));
    picked.conceptIds.forEach((id) => covered.add(id));
    usedTypes.add(picked.type);
  }
  return result;
}

/** Deadline is authoritative even when the modal was closed or the tab was asleep. */
export function expireMockExam(session: MockExamSession, now: number): MockExamSession {
  const deadline = Date.parse(session.endsAt);
  if (session.status !== 'in_progress' || (Number.isFinite(deadline) && now < deadline)) return session;
  return { ...session, status: 'submitted', submittedAt: Number.isFinite(deadline)
    ? new Date(deadline).toISOString() : new Date(now).toISOString() };
}

export function updateMockExamAnswer(session: MockExamSession, problemId: string, answer: string, now: number): MockExamSession {
  const active = expireMockExam(session, now);
  if (active.status !== 'in_progress' || !active.problems.some((p) => p.id === problemId)) return active;
  return { ...active, answers: { ...active.answers, [problemId]: answer } };
}

export function getExamScore(session: MockExamSession): number | null {
  if (!['graded', 'recorded'].includes(session.status) || !session.problems.length) return null;
  return Math.round(session.problems.reduce((sum, problem) =>
    sum + (session.evaluations[problem.id]?.calculatedScore ?? 0), 0) / session.problems.length);
}

export type ExamOpenPolicy = 'running' | 'expired_manual';

/**
 * Opening a stale exam through a direct URL must NOT trigger a new submit by
 * itself: the deadline policy applies to a session that was ALREADY running,
 * while a URL-open of an expired session offers an explicit '저장된 답안으로
 * 제출' action instead.
 */
export function examOpenPolicy(
  session: MockExamSession | null,
  deferExpiredSubmit: boolean
): ExamOpenPolicy {
  if (!session || session.status !== 'submitted' || !deferExpiredSubmit) return 'running';
  return 'expired_manual';
}
