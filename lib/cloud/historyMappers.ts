import type {
  Attempt,
  MockExamSession,
  ReviewEvent,
  StudyPlanItem,
  StudyPlanSettings,
} from '../types';
import type {
  AttemptRow,
  AttemptUpsert,
  MockExamSessionRow,
  MockExamSessionUpsert,
  ReviewEventRow,
  ReviewEventUpsert,
  StudyPlanItemRow,
  StudyPlanItemUpsert,
} from './historyTypes';

function doc<T>(payload: Record<string, unknown> | null): Partial<T> {
  return (payload ?? {}) as Partial<T>;
}

// --- attempts --------------------------------------------------------------

export function rowToAttempt(row: AttemptRow): Attempt {
  return {
    ...doc<Attempt>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    conceptId: row.concept_id,
    problemId: row.problem_id,
    at: row.at,
    calculatedScore: Number(row.calculated_score),
    problemVersion: row.problem_version,
    attemptOrigin: (row.attempt_origin as Attempt['attemptOrigin']) ?? 'independent',
    mockExamSessionId: row.mock_exam_session_id ?? undefined,
    planItemId: row.plan_item_id ?? undefined,
  } as Attempt;
}

export function attemptToUpsert(attempt: Attempt): AttemptUpsert {
  return {
    id: attempt.id,
    subject_id: attempt.subjectId,
    concept_id: attempt.conceptId,
    problem_id: attempt.problemId,
    mock_exam_session_id: attempt.mockExamSessionId ?? null,
    plan_item_id: attempt.planItemId ?? null,
    attempt_origin: attempt.attemptOrigin ?? 'independent',
    problem_version: attempt.problemVersion ?? 1,
    at: attempt.at,
    calculated_score: attempt.calculatedScore ?? 0,
    payload: attempt as unknown as Record<string, unknown>,
  };
}

// --- review events ---------------------------------------------------------

export function rowToReviewEvent(row: ReviewEventRow): ReviewEvent {
  return {
    ...doc<ReviewEvent>(row.payload),
    id: row.id,
    conceptId: row.concept_id,
    at: row.at,
    kind: row.kind as ReviewEvent['kind'],
    resultScore: Number(row.result_score),
    attemptId: row.attempt_id ?? undefined,
  } as ReviewEvent;
}

export function reviewEventToUpsert(event: ReviewEvent, subjectId: string): ReviewEventUpsert {
  return {
    id: event.id,
    subject_id: subjectId,
    concept_id: event.conceptId,
    attempt_id: event.attemptId ?? null,
    kind: event.kind,
    at: event.at,
    result_score: event.resultScore ?? 0,
    payload: event as unknown as Record<string, unknown>,
  };
}

// --- study plan items ------------------------------------------------------

export function rowToStudyPlanItem(row: StudyPlanItemRow): StudyPlanItem {
  return {
    ...doc<StudyPlanItem>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    kind: row.kind as StudyPlanItem['kind'],
    assignedDate: row.assigned_date,
    status: row.status as StudyPlanItem['status'],
    round: row.round ?? undefined,
    completedAttemptId: row.completed_attempt_id ?? undefined,
    completedEventId: row.completed_event_id ?? undefined,
    completedMockSessionId: row.completed_mock_session_id ?? undefined,
  } as StudyPlanItem;
}

export function studyPlanItemToUpsert(item: StudyPlanItem): StudyPlanItemUpsert {
  return {
    id: item.id,
    subject_id: item.subjectId,
    kind: item.kind,
    assigned_date: item.assignedDate,
    status: item.status,
    round: item.round ?? null,
    completed_attempt_id: item.completedAttemptId ?? null,
    completed_event_id: item.completedEventId ?? null,
    completed_mock_session_id: item.completedMockSessionId ?? null,
    payload: item as unknown as Record<string, unknown>,
  };
}

export function settingsToPayload(settings: StudyPlanSettings): Record<string, unknown> {
  return settings as unknown as Record<string, unknown>;
}

// --- mock exams ------------------------------------------------------------

export function rowToMockExamSession(row: MockExamSessionRow): MockExamSession {
  return {
    ...doc<MockExamSession>(row.payload),
    id: row.id,
    subjectId: row.subject_id,
    status: row.status as MockExamSession['status'],
    durationMinutes: row.duration_minutes,
    createdAt: row.created_at,
    endsAt: row.ends_at,
    submittedAt: row.submitted_at ?? undefined,
    serverVersion: Number(row.version ?? 1),
  } as MockExamSession;
}

export function mockExamSessionToUpsert(session: MockExamSession): MockExamSessionUpsert {
  return {
    id: session.id,
    subject_id: session.subjectId,
    status: session.status,
    duration_minutes: session.durationMinutes,
    created_at: session.createdAt,
    ends_at: session.endsAt,
    submitted_at: session.submittedAt ?? null,
    payload: session as unknown as Record<string, unknown>,
  };
}
