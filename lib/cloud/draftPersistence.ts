import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConceptDraft, ProblemDraft } from '../types';
import { upsertConceptDrafts, upsertProblemDrafts } from './learningRepository';

/**
 * Persists generated drafts and shapes the API response:
 *  - success → return the SERVER drafts (DB updatedAt / contentVersion /
 *    approval state), so a first approval cannot hit DRAFT_STALE;
 *  - failure → keep the generated drafts unchanged so persistence can be
 *    retried (via /api/persist-drafts) without re-calling the paid AI.
 */
export interface DraftPersistOutcome<T> {
  persisted: boolean;
  drafts: T[];
  persistError?: string;
}

export async function persistConceptDraftsForResponse(
  supabase: SupabaseClient,
  drafts: ConceptDraft[],
  jobId?: string
): Promise<DraftPersistOutcome<ConceptDraft>> {
  try {
    const saved = await upsertConceptDrafts(supabase, drafts, jobId);
    if (saved.ok) return { persisted: true, drafts: saved.data };
    return { persisted: false, drafts, persistError: saved.error };
  } catch (error) {
    return {
      persisted: false,
      drafts,
      persistError: error instanceof Error ? error.message : '초안 저장에 실패했습니다.',
    };
  }
}

export async function persistProblemDraftsForResponse(
  supabase: SupabaseClient,
  drafts: ProblemDraft[],
  jobId?: string
): Promise<DraftPersistOutcome<ProblemDraft>> {
  try {
    const saved = await upsertProblemDrafts(supabase, drafts, jobId);
    if (saved.ok) return { persisted: true, drafts: saved.data };
    return { persisted: false, drafts, persistError: saved.error };
  } catch (error) {
    return {
      persisted: false,
      drafts,
      persistError: error instanceof Error ? error.message : '초안 저장에 실패했습니다.',
    };
  }
}
