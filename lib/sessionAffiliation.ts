/**
 * Pure helper: which subject does an in-progress practice session belong to?
 *
 * A session is pinned to the problem it was opened for. When the user switches
 * to another subject, the session must NOT be re-labelled as that subject's
 * session; the UI shows its real affiliation and a return path instead.
 */
export interface PinnedSessionProblem {
  id: string;
  subjectId: string;
}

export type SessionAffiliation =
  | { kind: 'none' }
  | { kind: 'same_subject'; problemId: string; problemSubjectId: string }
  | { kind: 'other_subject'; problemId: string; problemSubjectId: string };

export function resolveSessionAffiliation(
  pinned: PinnedSessionProblem | null | undefined,
  activeSubjectId: string
): SessionAffiliation {
  if (!pinned) return { kind: 'none' };
  if (pinned.subjectId === activeSubjectId) {
    return { kind: 'same_subject', problemId: pinned.id, problemSubjectId: pinned.subjectId };
  }
  return { kind: 'other_subject', problemId: pinned.id, problemSubjectId: pinned.subjectId };
}
