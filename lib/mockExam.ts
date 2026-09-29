import { Concept, MockExamSession, Problem, ProblemType, Subject, isProblemAvailableForPractice } from './types';

const STORAGE_KEY = 'redcall_mock_exam_sessions_v1';

export function loadMockExams(): MockExamSession[] {
  try {
    if (typeof window === 'undefined') return [];
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed as MockExamSession[] : [];
  } catch { return []; }
}

export function saveMockExam(session: MockExamSession): void {
  const existing = loadMockExams();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([session, ...existing.filter((item) => item.id !== session.id)]));
}

export function clearMockExams(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

/** Deterministic selection favors distinct topics and formats, then weak concepts. */
export function selectMockExamProblems(
  subject: Subject, concepts: Concept[], problems: Problem[],
  conceptIds: string[], types: ProblemType[], count: number
): Problem[] {
  const selected = new Set(conceptIds);
  const allowedTypes = new Set(types);
  const scores = new Map(concepts.filter((c) => c.subjectId === subject.id).map((c) => [c.id, c.currentScore]));
  const pool = problems.filter((p) => p.subjectId === subject.id &&
    p.isApproved !== false && isProblemAvailableForPractice(p) &&
    allowedTypes.has(p.type) && p.conceptIds.some((id) => selected.has(id)));
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

export function getExamScore(session: MockExamSession): number | null {
  if (!['graded', 'recorded'].includes(session.status) || !session.problems.length) return null;
  return Math.round(session.problems.reduce((sum, problem) =>
    sum + (session.evaluations[problem.id]?.calculatedScore ?? 0), 0) / session.problems.length);
}
