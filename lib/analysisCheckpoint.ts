import { ConceptDraft } from './types';

export type ChunkAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ChunkProgressRecord {
  chunkIndex: number;
  totalChunks: number;
  sourceContext: string;
  status: ChunkAnalysisStatus;
  drafts: ConceptDraft[];
  error?: string;
  completedAt?: string;
}

export interface AnalysisSessionLedger {
  jobKey: string;
  userId: string;
  materialId: string;
  markdownHash: string;
  domain: string;
  totalChunks: number;
  chunks: Record<number, ChunkProgressRecord>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deterministically constructs an analysis job key from input parameters.
 * If user, material, markdown content, domain or prompt version change, a new key is derived.
 */
export function makeAnalysisJobKey(
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  promptVersion = 'v2'
): string {
  return `analysis_${userId}_${materialId}_${markdownHash}_${domain}_${promptVersion}`;
}

// In-memory server-side ledger registry (LRU-bounded to 100 recent sessions)
const MAX_SESSIONS = 100;
const sessionRegistry = new Map<string, AnalysisSessionLedger>();

export function getOrCreateSessionLedger(
  jobKey: string,
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  totalChunks: number,
  chunkContexts?: Array<{ chunkIndex: number; sourceContext: string }>
): AnalysisSessionLedger {
  let session = sessionRegistry.get(jobKey);
  if (!session) {
    if (sessionRegistry.size >= MAX_SESSIONS) {
      // Evict oldest session
      const oldestKey = sessionRegistry.keys().next().value;
      if (oldestKey) sessionRegistry.delete(oldestKey);
    }
    const chunks: Record<number, ChunkProgressRecord> = {};
    for (let i = 1; i <= totalChunks; i++) {
      const ctx = chunkContexts?.find((c) => c.chunkIndex === i)?.sourceContext || `청크 ${i}`;
      chunks[i] = {
        chunkIndex: i,
        totalChunks,
        sourceContext: ctx,
        status: 'pending',
        drafts: [],
      };
    }
    session = {
      jobKey,
      userId,
      materialId,
      markdownHash,
      domain,
      totalChunks,
      chunks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessionRegistry.set(jobKey, session);
  }
  return session;
}

export function recordChunkResult(
  jobKey: string,
  chunkIndex: number,
  status: 'completed' | 'failed',
  drafts: ConceptDraft[],
  error?: string
): void {
  const session = sessionRegistry.get(jobKey);
  if (!session) return;
  session.chunks[chunkIndex] = {
    ...(session.chunks[chunkIndex] || {
      chunkIndex,
      totalChunks: session.totalChunks,
      sourceContext: `청크 ${chunkIndex}`,
    }),
    status,
    drafts: status === 'completed' ? drafts : [],
    error,
    completedAt: status === 'completed' ? new Date().toISOString() : undefined,
  };
  session.updatedAt = new Date().toISOString();
}

export function getSessionProgress(session: AnalysisSessionLedger): {
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  pendingChunks: number;
  isAllComplete: boolean;
  allDrafts: ConceptDraft[];
} {
  let completed = 0;
  let failed = 0;
  let pending = 0;
  const allDraftsRaw: ConceptDraft[] = [];

  for (let i = 1; i <= session.totalChunks; i++) {
    const chunk = session.chunks[i];
    if (!chunk || chunk.status === 'pending') {
      pending++;
    } else if (chunk.status === 'completed') {
      completed++;
      allDraftsRaw.push(...chunk.drafts);
    } else if (chunk.status === 'failed') {
      failed++;
    } else {
      pending++;
    }
  }

  return {
    totalChunks: session.totalChunks,
    completedChunks: completed,
    failedChunks: failed,
    pendingChunks: pending,
    isAllComplete: completed === session.totalChunks && session.totalChunks > 0,
    allDrafts: deduplicateConceptDrafts(allDraftsRaw),
  };
}

/**
 * Deduplicate concepts across multiple chunks by normalized title,
 * preserving all source citations and enriching definitions.
 */
export function deduplicateConceptDrafts(drafts: ConceptDraft[]): ConceptDraft[] {
  const deduplicated: ConceptDraft[] = [];
  const titleMap = new Map<string, number>();

  for (const draft of drafts) {
    const normalized = draft.title.replace(/\s+/g, '').toLowerCase();
    if (titleMap.has(normalized)) {
      const existingIdx = titleMap.get(normalized)!;
      const existing = deduplicated[existingIdx];

      // Merge prerequisites and related concepts
      existing.prerequisites = Array.from(new Set([...existing.prerequisites, ...draft.prerequisites]));
      existing.relatedConcepts = Array.from(new Set([...existing.relatedConcepts, ...draft.relatedConcepts]));
      existing.commonMisconceptions = Array.from(
        new Set([...existing.commonMisconceptions, ...draft.commonMisconceptions])
      );
      existing.examples = Array.from(new Set([...existing.examples, ...draft.examples]));

      // Keep richer description
      if (draft.description.length > existing.description.length) {
        existing.description = draft.description;
      }
      if (!existing.coreDefinitionFormulaOrAlgorithm && draft.coreDefinitionFormulaOrAlgorithm) {
        existing.coreDefinitionFormulaOrAlgorithm = draft.coreDefinitionFormulaOrAlgorithm;
      }
      // If the incoming draft has a verified source evidence, preserve it
      if (!existing.sourceEvidence.verified && draft.sourceEvidence.verified) {
        existing.sourceEvidence = draft.sourceEvidence;
      }
    } else {
      titleMap.set(normalized, deduplicated.length);
      deduplicated.push({ ...draft });
    }
  }
  return deduplicated;
}
