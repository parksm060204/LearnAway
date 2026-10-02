/** Row shapes for learning-content tables. `payload` holds the full app type. */

export interface ConceptRow {
  id: string;
  user_id: string;
  subject_id: string;
  title: string;
  order_index: number;
  status: string;
  current_score: number;
  is_learned: boolean;
  is_demo: boolean;
  version: number;
  draft_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type ConceptUpsert = Omit<ConceptRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface ConceptDraftRow {
  id: string;
  user_id: string;
  subject_id: string;
  material_id: string | null;
  title: string;
  status: string;
  is_approved: boolean;
  content_version: number;
  generation_job_id: string | null;
  approved_concept_id: string | null;
  approval_state: string;
  approval_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type ConceptDraftUpsert = Omit<ConceptDraftRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface ProblemRow {
  id: string;
  user_id: string;
  subject_id: string;
  title: string;
  type: string;
  is_approved: boolean;
  is_outdated: boolean;
  needs_source_review: boolean;
  quality_status: string;
  version: number;
  draft_id: string | null;
  is_transfer: boolean;
  source_problem_id: string | null;
  logic_session_id: string | null;
  is_demo: boolean;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type ProblemUpsert = Omit<ProblemRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface ProblemDraftRow {
  id: string;
  user_id: string;
  subject_id: string;
  title: string;
  type: string;
  status: string;
  is_approved: boolean;
  is_demo: boolean;
  content_version: number;
  generation_job_id: string | null;
  approved_problem_id: string | null;
  approval_state: string;
  approval_error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export type ProblemDraftUpsert = Omit<ProblemDraftRow, 'user_id' | 'created_at' | 'updated_at'>;

export interface ProblemVersionRow {
  id: number;
  user_id: string;
  problem_id: string;
  subject_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  created_at: string;
}
