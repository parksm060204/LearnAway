/** Row shapes for learning-history tables. `payload` holds the full app type. */

export interface AttemptRow {
  id: string;
  user_id: string;
  subject_id: string;
  concept_id: string;
  problem_id: string;
  mock_exam_session_id: string | null;
  plan_item_id: string | null;
  attempt_origin: string;
  problem_version: number;
  at: string;
  calculated_score: number;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type AttemptUpsert = Omit<AttemptRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface ReviewEventRow {
  id: string;
  user_id: string;
  subject_id: string;
  concept_id: string;
  attempt_id: string | null;
  kind: string;
  at: string;
  result_score: number;
  payload: Record<string, unknown> | null;
  created_at: string;
}
export type ReviewEventUpsert = Omit<ReviewEventRow, 'user_id' | 'created_at'>;

export interface StudyPlanSettingsRow {
  user_id: string;
  payload: Record<string, unknown> | null;
  updated_at: string;
}

export interface StudyPlanItemRow {
  id: string;
  user_id: string;
  subject_id: string;
  kind: string;
  assigned_date: string;
  status: string;
  round: number | null;
  completed_attempt_id: string | null;
  completed_event_id: string | null;
  completed_mock_session_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type StudyPlanItemUpsert = Omit<StudyPlanItemRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface MockExamSessionRow {
  id: string;
  user_id: string;
  subject_id: string;
  status: string;
  duration_minutes: number;
  created_at: string;
  ends_at: string;
  submitted_at: string | null;
  version: number;
  payload: Record<string, unknown> | null;
  updated_at: string;
}
export type MockExamSessionUpsert = Omit<MockExamSessionRow, 'user_id' | 'updated_at' | 'version'>;
