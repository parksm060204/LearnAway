import { ConceptDraft, ConceptEvidence } from './types';

export type ChunkAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ChunkProgressRecord {
  chunkIndex: number;
  totalChunks: number;
  sourceContext: string;
  status: ChunkAnalysisStatus;
  drafts: ConceptDraft[];
  attemptCount?: number;
  leaseWorkerId?: string | null;
  leaseExpiresAt?: string | null;
  error?: string;
  completedAt?: string;
}

export interface AnalysisSessionLedger {
  jobKey: string;
  userId: string;
  materialId: string;
  markdownHash: string;
  domain: string;
  promptVersion: string;
  chunkingVersion: string;
  totalChunks: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
  chunks: Record<number, ChunkProgressRecord>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deterministically constructs an analysis job key from input parameters.
 * If user, material, markdown content, domain, prompt version or chunking version change,
 * a new distinct key is derived.
 */
export function makeAnalysisJobKey(
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  promptVersion = 'v2',
  chunkingVersion = 'v1'
): string {
  return `analysis_${userId}_${materialId}_${markdownHash}_${domain}_${promptVersion}_${chunkingVersion}`;
}

/**
 * Deterministically derives a unique ConceptDraft ID from the generation job ID
 * and normalized concept title.
 * Invariant: Completion order or array index shifts NEVER change the draft ID.
 */
export function makeConceptDraftId(generationJobId: string, title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, '');
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const safeSlug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 24);
  return `${generationJobId}-c-${safeSlug || 'item'}-${hex}`;
}

// User-isolated memory registry: Map<userId, Map<jobKey, AnalysisSessionLedger>>
// Bounded to prevent memory bloat, strictly scoped per user.
const MAX_SESSIONS_PER_USER = 50;
const userSessionRegistries = new Map<string, Map<string, AnalysisSessionLedger>>();

function getUserRegistry(userId: string): Map<string, AnalysisSessionLedger> {
  let reg = userSessionRegistries.get(userId);
  if (!reg) {
    reg = new Map<string, AnalysisSessionLedger>();
    userSessionRegistries.set(userId, reg);
  }
  return reg;
}

/**
 * Validates ownership and input consistency of an existing analysis session.
 * Rejects mismatched materials, hashes or domains. Never reveals other users' sessions.
 */
export function validateJobIdentity(
  session: AnalysisSessionLedger | null,
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string
): { ok: true } | { ok: false; code: 'NOT_FOUND_OR_FORBIDDEN' | 'JOB_INPUT_MISMATCH'; message: string } {
  if (!session || session.userId !== userId) {
    return {
      ok: false,
      code: 'NOT_FOUND_OR_FORBIDDEN',
      message: '작업을 찾을 수 없거나 접근 권한이 없습니다.',
    };
  }

  if (
    session.materialId !== materialId ||
    session.markdownHash !== markdownHash ||
    session.domain !== domain
  ) {
    return {
      ok: false,
      code: 'JOB_INPUT_MISMATCH',
      message: '동일한 작업 ID에 서로 다른 자료 식별자, 본문 해시, 또는 분야 설정을 전달할 수 없습니다.',
    };
  }

  return { ok: true };
}

export function getOrCreateSessionLedger(
  jobKey: string,
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  totalChunks: number,
  chunkContexts?: Array<{ chunkIndex: number; sourceContext: string }>,
  promptVersion = 'v2',
  chunkingVersion = 'v1'
): AnalysisSessionLedger {
  const reg = getUserRegistry(userId);
  let session = reg.get(jobKey);

  if (!session) {
    if (reg.size >= MAX_SESSIONS_PER_USER) {
      const oldestKey = reg.keys().next().value;
      if (oldestKey) reg.delete(oldestKey);
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
        attemptCount: 0,
      };
    }

    session = {
      jobKey,
      userId,
      materialId,
      markdownHash,
      domain,
      promptVersion,
      chunkingVersion,
      totalChunks,
      status: 'pending',
      chunks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    reg.set(jobKey, session);
  }

  return session;
}

export function findSessionLedger(userId: string, jobKey: string): AnalysisSessionLedger | null {
  const reg = getUserRegistry(userId);
  return reg.get(jobKey) || null;
}

export interface LeaseAcquireResult {
  acquired: boolean;
  reason: 'already_completed' | 'locked' | 'acquired' | 'not_found' | 'paused';
  record?: ChunkProgressRecord;
}

/**
 * Atomically acquires a worker lease on a chunk.
 * If already completed: returns already_completed (skips AI re-call).
 * If actively locked by another worker: returns locked (prevents concurrent duplicate).
 * If lease expired or pending/failed: grants lease to workerId.
 */
export function acquireChunkLease(
  session: AnalysisSessionLedger,
  chunkIndex: number,
  workerId: string,
  leaseMs = 90000,
  now = new Date()
): LeaseAcquireResult {
  if (session.status === 'paused') {
    return { acquired: false, reason: 'paused' };
  }
  const chunk = session.chunks[chunkIndex];
  if (!chunk) return { acquired: false, reason: 'not_found' };

  if (chunk.status === 'completed') {
    return { acquired: false, reason: 'already_completed', record: chunk };
  }

  const nowMs = now.getTime();
  const leaseExpiresMs = chunk.leaseExpiresAt ? new Date(chunk.leaseExpiresAt).getTime() : 0;
  const isLocked = chunk.status === 'running' && leaseExpiresMs > nowMs && chunk.leaseWorkerId !== workerId;

  if (isLocked) {
    return { acquired: false, reason: 'locked', record: chunk };
  }

  // Acquire lease
  const expiresAt = new Date(nowMs + leaseMs).toISOString();
  chunk.status = 'running';
  chunk.leaseWorkerId = workerId;
  chunk.leaseExpiresAt = expiresAt;
  chunk.attemptCount = (chunk.attemptCount || 0) + 1;
  session.status = 'processing';
  session.updatedAt = new Date().toISOString();

  return { acquired: true, reason: 'acquired', record: chunk };
}

export interface CommitChunkResult {
  committed: boolean;
  reason: 'lease_expired' | 'worker_mismatch' | 'committed' | 'not_found' | 'already_completed';
}

/**
 * Atomically commits chunk completion.
 * Guards against expired leases or late arrivals from prior workers.
 * Preserves valid empty results (drafts: []) as completed without re-calling AI.
 */
export function commitChunkResult(
  session: AnalysisSessionLedger,
  chunkIndex: number,
  workerId: string,
  status: 'completed' | 'failed',
  drafts: ConceptDraft[],
  error?: string,
  now = new Date()
): CommitChunkResult {
  const chunk = session.chunks[chunkIndex];
  if (!chunk) return { committed: false, reason: 'not_found' };

  if (chunk.status === 'completed') {
    return { committed: false, reason: 'already_completed' };
  }

  // Reject late write if worker does not hold the active lease
  if (chunk.leaseWorkerId !== workerId) {
    return { committed: false, reason: 'worker_mismatch' };
  }

  const nowMs = now.getTime();
  const leaseExpiresMs = chunk.leaseExpiresAt ? new Date(chunk.leaseExpiresAt).getTime() : 0;
  if (leaseExpiresMs < nowMs) {
    return { committed: false, reason: 'lease_expired' };
  }

  chunk.status = status;
  // Valid empty results are fully preserved as completed
  chunk.drafts = status === 'completed' ? drafts : [];
  chunk.error = error;
  chunk.leaseWorkerId = null;
  chunk.leaseExpiresAt = null;
  if (status === 'completed') {
    chunk.completedAt = now.toISOString();
  }
  session.updatedAt = now.toISOString();

  // Check if all chunks completed
  let allDone = true;
  for (let i = 1; i <= session.totalChunks; i++) {
    if (session.chunks[i]?.status !== 'completed') {
      allDone = false;
      break;
    }
  }
  if (allDone && session.totalChunks > 0) {
    session.status = 'completed';
  }

  return { committed: true, reason: 'committed' };
}

export function recordChunkResult(
  jobKey: string,
  chunkIndex: number,
  status: 'completed' | 'failed',
  drafts: ConceptDraft[],
  error?: string,
  userId?: string
): void {
  // Support both user-scoped and global lookup for backwards compatibility
  let session: AnalysisSessionLedger | undefined;
  if (userId) {
    session = getUserRegistry(userId).get(jobKey);
  } else {
    for (const reg of userSessionRegistries.values()) {
      if (reg.has(jobKey)) {
        session = reg.get(jobKey);
        break;
      }
    }
  }
  if (!session) return;

  const chunk = session.chunks[chunkIndex] || {
    chunkIndex,
    totalChunks: session.totalChunks,
    sourceContext: `청크 ${chunkIndex}`,
    status,
    drafts: [],
  };

  chunk.status = status;
  chunk.drafts = status === 'completed' ? drafts : [];
  chunk.error = error;
  chunk.leaseWorkerId = null;
  chunk.leaseExpiresAt = null;
  if (status === 'completed') {
    chunk.completedAt = new Date().toISOString();
  }
  session.chunks[chunkIndex] = chunk;
  session.updatedAt = new Date().toISOString();
}

export function getSessionProgress(session: AnalysisSessionLedger): {
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  pendingChunks: number;
  isAllComplete: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
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

  const isAllComplete = completed === session.totalChunks && session.totalChunks > 0;
  return {
    totalChunks: session.totalChunks,
    completedChunks: completed,
    failedChunks: failed,
    pendingChunks: pending,
    isAllComplete,
    status: isAllComplete ? 'completed' : session.status,
    allDrafts: deduplicateConceptDrafts(allDraftsRaw),
  };
}

/**
 * Deduplicate concepts across multiple chunks by normalized title.
 * Preserves all source citations across multiple sections/chunks.
 * Preserves approved or user-edited status and prevents overwriting.
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

      // Preserve all distinct source citations
      const existingEvidences: ConceptEvidence[] = [
        existing.sourceEvidence,
        ...(existing.additionalEvidences || []),
      ].filter(Boolean);

      const isNewEvidence = !existingEvidences.some(
        (e) =>
          e.pageNumber === draft.sourceEvidence.pageNumber &&
          e.blockIndex === draft.sourceEvidence.blockIndex &&
          e.quote === draft.sourceEvidence.quote
      );

      if (isNewEvidence && draft.sourceEvidence.quote) {
        if (!existing.additionalEvidences) {
          existing.additionalEvidences = [];
        }
        existing.additionalEvidences.push(draft.sourceEvidence);
      }

      // If incoming draft has verified evidence, upgrade primary sourceEvidence
      if (!existing.sourceEvidence.verified && draft.sourceEvidence.verified) {
        if (existing.sourceEvidence.quote) {
          if (!existing.additionalEvidences) existing.additionalEvidences = [];
          existing.additionalEvidences.push(existing.sourceEvidence);
        }
        existing.sourceEvidence = draft.sourceEvidence;
      }

      // Preserve user approval or user edits if present
      if (draft.isApproved || draft.editedByUser) {
        existing.isApproved = draft.isApproved || existing.isApproved;
        existing.editedByUser = draft.editedByUser || existing.editedByUser;
        if (draft.status !== 'draft') {
          existing.status = draft.status;
        }
      }
    } else {
      titleMap.set(normalized, deduplicated.length);
      deduplicated.push({ ...draft });
    }
  }
  return deduplicated;
}
