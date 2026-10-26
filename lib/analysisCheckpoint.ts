import { ConceptDraft, ConceptEvidence } from './types';
import { computeMarkdownHash } from './markdownUtils';

export type ChunkAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ChunkProgressRecord {
  chunkIndex: number;
  totalChunks: number;
  sourceContext: string;
  status: ChunkAnalysisStatus;
  drafts: ConceptDraft[];
  attemptCount?: number;
  leaseWorkerId?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: string | null;
  error?: string;
  completedAt?: string;
}

export interface AnalysisSessionLedger {
  jobKey: string;
  userId: string;
  subjectId: string;
  materialId: string;
  markdownHash: string;
  domain: string;
  modelId: string;
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
 * Incorporates user, subject, material, markdown content, domain, model, prompt version, and chunking version.
 */
export function makeAnalysisJobKey(
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  promptVersion = 'v2',
  chunkingVersion = 'v1',
  modelId = 'deepseek-v4.1-flash',
  subjectId = ''
): string {
  return `analysis_${userId}_${subjectId || 'nosub'}_${materialId}_${markdownHash}_${domain}_${modelId}_${promptVersion}_${chunkingVersion}`;
}

/**
 * Deterministically constructs the AI input identifier for an analysis task.
 * Incorporates subject, material, markdownHash, domain, model, prompt version, and chunking version
 * so that identical content in different materials or different subjects have distinct task identities.
 */
export function computeAnalysisInputIdentifier(
  subjectId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  modelId = 'deepseek-v4.1-flash',
  promptVersion = 'v2',
  chunkingVersion = 'v1'
): string {
  return computeMarkdownHash(
    JSON.stringify({
      version: 'v2',
      subjectId: subjectId || 'nosub',
      materialId,
      markdownHash,
      domain,
      modelId,
      promptVersion,
      chunkingVersion,
    })
  );
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
 * Rejects mismatched materials, hashes, domains, subjects or models. Never reveals other users' sessions.
 */
export function validateJobIdentity(
  session: AnalysisSessionLedger | null,
  userId: string,
  materialId: string,
  markdownHash: string,
  domain: string,
  subjectId?: string,
  modelId?: string
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
    session.domain !== domain ||
    (subjectId && session.subjectId && session.subjectId !== subjectId) ||
    (modelId && session.modelId && session.modelId !== modelId)
  ) {
    return {
      ok: false,
      code: 'JOB_INPUT_MISMATCH',
      message: '동일한 작업 ID에 서로 다른 과목, 자료 식별자, 본문 해시, 모델, 또는 분야 설정을 전달할 수 없습니다.',
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
  chunkingVersion = 'v1',
  subjectId = '',
  modelId = 'deepseek-v4.1-flash'
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
      subjectId,
      materialId,
      markdownHash,
      domain,
      modelId,
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

export function findLatestSessionForMaterial(userId: string, materialId: string): AnalysisSessionLedger | null {
  const reg = getUserRegistry(userId);
  let latest: AnalysisSessionLedger | null = null;
  for (const session of reg.values()) {
    if (session.materialId === materialId) {
      if (!latest || new Date(session.updatedAt).getTime() > new Date(latest.updatedAt).getTime()) {
        latest = session;
      }
    }
  }
  return latest;
}

export interface LeaseAcquireResult {
  acquired: boolean;
  reason: 'already_completed' | 'locked' | 'acquired' | 'not_found' | 'paused';
  leaseToken?: string;
  record?: ChunkProgressRecord;
}

/**
 * Atomically acquires a worker lease on a chunk.
 * If already completed: returns already_completed (skips AI re-call).
 * If actively locked by another worker: returns locked (prevents concurrent duplicate).
 * If lease expired or pending/failed: grants lease to workerId with a unique leaseToken.
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
  const leaseToken = `tok_${nowMs}_${Math.random().toString(36).substring(2, 10)}`;
  chunk.status = 'running';
  chunk.leaseWorkerId = workerId;
  chunk.leaseToken = leaseToken;
  chunk.leaseExpiresAt = expiresAt;
  chunk.attemptCount = (chunk.attemptCount || 0) + 1;
  session.status = 'processing';
  session.updatedAt = new Date().toISOString();

  return { acquired: true, reason: 'acquired', leaseToken, record: chunk };
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
  nowOrLeaseToken?: Date | string,
  leaseToken?: string
): CommitChunkResult {
  let now = new Date();
  let token = leaseToken;
  if (typeof nowOrLeaseToken === 'string') {
    token = nowOrLeaseToken;
  } else if (nowOrLeaseToken instanceof Date) {
    now = nowOrLeaseToken;
  }

  const chunk = session.chunks[chunkIndex];
  if (!chunk) return { committed: false, reason: 'not_found' };

  if (chunk.status === 'completed') {
    return { committed: false, reason: 'already_completed' };
  }

  // Reject late write if worker does not hold the active lease
  if (chunk.leaseWorkerId !== workerId) {
    return { committed: false, reason: 'worker_mismatch' };
  }

  if (token && chunk.leaseToken && chunk.leaseToken !== token) {
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
  chunk.leaseToken = null;
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
  runningChunks: number;
  failedChunks: number;
  pendingChunks: number;
  isAllComplete: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'paused';
  allDrafts: ConceptDraft[];
} {
  let completed = 0;
  let failed = 0;
  let running = 0;
  let pending = 0;
  const allDraftsRaw: ConceptDraft[] = [];

  for (let i = 1; i <= session.totalChunks; i++) {
    const chunk = session.chunks[i];
    if (!chunk || chunk.status === 'pending') {
      pending++;
    } else if (chunk.status === 'completed') {
      completed++;
      allDraftsRaw.push(...chunk.drafts);
    } else if (chunk.status === 'running') {
      running++;
    } else if (chunk.status === 'failed') {
      failed++;
    } else {
      pending++;
    }
  }

  const isAllComplete = completed === session.totalChunks && session.totalChunks > 0;
  let computedStatus = session.status;
  if (isAllComplete) {
    computedStatus = 'completed';
  } else if (session.status === 'paused') {
    computedStatus = 'paused';
  } else if (running > 0 || (completed > 0 && !isAllComplete)) {
    computedStatus = 'processing';
  } else if (failed === session.totalChunks && session.totalChunks > 0) {
    computedStatus = 'failed';
  }

  return {
    totalChunks: session.totalChunks,
    completedChunks: completed,
    runningChunks: running,
    failedChunks: failed,
    pendingChunks: pending,
    isAllComplete,
    status: computedStatus,
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
      existing.prerequisites = Array.from(new Set([...(existing.prerequisites || []), ...(draft.prerequisites || [])]));
      existing.relatedConcepts = Array.from(new Set([...(existing.relatedConcepts || []), ...(draft.relatedConcepts || [])]));
      existing.commonMisconceptions = Array.from(
        new Set([...(existing.commonMisconceptions || []), ...(draft.commonMisconceptions || [])])
      );
      existing.examples = Array.from(new Set([...(existing.examples || []), ...(draft.examples || [])]));

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

/**
 * Synchronizes an authoritative DB chunk lease into the session ledger.
 */
export function syncDbLeaseToLedger(
  session: AnalysisSessionLedger,
  chunkIndex: number,
  workerId: string,
  leaseToken: string,
  leaseExpiresAt?: string
): void {
  const chunk = session.chunks[chunkIndex];
  if (!chunk) return;
  chunk.status = 'running';
  chunk.leaseWorkerId = workerId;
  chunk.leaseToken = leaseToken;
  chunk.leaseExpiresAt = leaseExpiresAt || new Date(Date.now() + 90000).toISOString();
  chunk.attemptCount = (chunk.attemptCount || 0) + 1;
  session.status = 'processing';
  session.updatedAt = new Date().toISOString();
}

/**
 * Directly records an authoritative completed/failed DB result into the session ledger.
 */
export function recordAuthoritativeChunkResult(
  session: AnalysisSessionLedger,
  chunkIndex: number,
  status: 'completed' | 'failed',
  drafts: ConceptDraft[],
  error?: string
): void {
  const chunk = session.chunks[chunkIndex];
  if (!chunk) return;
  chunk.status = status;
  chunk.drafts = status === 'completed' ? drafts : [];
  chunk.error = error;
  chunk.leaseWorkerId = null;
  chunk.leaseToken = null;
  chunk.leaseExpiresAt = null;
  if (status === 'completed') {
    chunk.completedAt = new Date().toISOString();
  }
  session.updatedAt = new Date().toISOString();

  let allDone = true;
  for (let i = 1; i <= session.totalChunks; i++) {
    if (session.chunks[i]?.status !== 'completed') {
      allDone = false;
      break;
    }
  }
  if (allDone) {
    session.status = 'completed';
  }
}

