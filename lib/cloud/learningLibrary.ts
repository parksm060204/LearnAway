import type { SupabaseClient } from '@supabase/supabase-js';
import type { Concept, ConceptDraft, Problem, ProblemDraft, ProblemVersionSnapshot } from '../types';
import {
  listConceptDrafts,
  listConcepts,
  listProblemDrafts,
  listProblemVersions,
  listProblems,
} from './learningRepository';
import type { RepoResult } from './types';
import { repoOk } from './types';

export interface CloudLearningLibrary {
  concepts: Concept[];
  conceptDrafts: ConceptDraft[];
  problems: Problem[];
  problemDrafts: ProblemDraft[];
  problemVersions: Record<string, ProblemVersionSnapshot[]>;
}

/**
 * Loads the learning-content library from Supabase. Server data is
 * authoritative: any failed read returns an error and is never silently
 * replaced by an empty list or local data.
 */
export async function loadLearningLibrary(
  supabase: SupabaseClient
): Promise<RepoResult<CloudLearningLibrary>> {
  const concepts = await listConcepts(supabase);
  if (!concepts.ok) return concepts;
  const conceptDrafts = await listConceptDrafts(supabase);
  if (!conceptDrafts.ok) return conceptDrafts;
  const problems = await listProblems(supabase);
  if (!problems.ok) return problems;
  const problemDrafts = await listProblemDrafts(supabase);
  if (!problemDrafts.ok) return problemDrafts;

  const problemVersions: Record<string, ProblemVersionSnapshot[]> = {};
  for (const problem of problems.data) {
    if ((problem.version ?? 1) > 1) {
      const versions = await listProblemVersions(supabase, problem.id);
      if (!versions.ok) return versions;
      problemVersions[problem.id] = versions.data;
    }
  }

  return repoOk({
    concepts: concepts.data,
    conceptDrafts: conceptDrafts.data,
    problems: problems.data,
    problemDrafts: problemDrafts.data,
    problemVersions,
  });
}
