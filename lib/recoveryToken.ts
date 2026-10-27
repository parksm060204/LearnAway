import crypto from 'crypto';
import type { ConceptDraft } from './types';

export interface RecoveryTokenPayload {
  userId: string;
  jobId: string;
  materialId: string;
  subjectId: string;
  domain: string;
  chunkIndex: number;
  markdownHash: string;
  modelId: string;
  draftsHash: string;
  schemaVersion: string;
  expiresAt: number; // Unix timestamp in ms
}

/**
 * Checks if a valid server recovery signing secret is configured.
 * Must be checked before initiating paid AI calls.
 */
export function hasRecoverySigningSecret(): boolean {
  return Boolean(
    process.env.ANALYSIS_RECOVERY_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET
  );
}

/**
 * Returns a stable, internal HMAC secret derived from server environment variables.
 * Fails explicitly if no server secret is configured; NEVER falls back to a public string.
 */
export function getRecoverySecret(): string {
  const secret =
    process.env.ANALYSIS_RECOVERY_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET;

  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error(
      '서버 복구 서명 비밀키(ANALYSIS_RECOVERY_SIGNING_SECRET 또는 SUPABASE_SERVICE_ROLE_KEY)가 설정되지 않았습니다. 서버 환경 변수를 확인해 주세요.'
    );
  }
  return secret.trim();
}

/**
 * Deterministically computes a SHA-256 hash of a list of ConceptDrafts.
 * Normalizes title, description, core definition, materialId, subjectId,
 * sourceMarkdownHash, verified source evidence, and additionalEvidences to prevent tampering.
 */
export function computeDraftsHash(drafts: ConceptDraft[]): string {
  const normalized = drafts.map((d) => ({
    id: d.id,
    materialId: d.materialId || '',
    subjectId: d.subjectId || '',
    title: (d.title || '').trim(),
    domain: d.domain,
    description: (d.description || '').trim(),
    coreDef: (d.coreDefinitionFormulaOrAlgorithm || '').trim(),
    prereqs: [...(d.prerequisites || [])].sort(),
    related: [...(d.relatedConcepts || [])].sort(),
    misconceptions: [...(d.commonMisconceptions || [])].sort(),
    examples: [...(d.examples || [])].sort(),
    sourceMarkdownHash: d.sourceMarkdownHash || '',
    sourceEvidence: {
      type: d.sourceEvidence?.type,
      pageNumber: typeof d.sourceEvidence?.pageNumber === 'number' ? d.sourceEvidence.pageNumber : null,
      blockIndex: typeof d.sourceEvidence?.blockIndex === 'number' ? d.sourceEvidence.blockIndex : null,
      timestamp: d.sourceEvidence?.timestamp ?? null,
      quote: (d.sourceEvidence?.quote || '').trim(),
      verified: Boolean(d.sourceEvidence?.verified),
    },
    additionalEvidences: Array.isArray(d.additionalEvidences)
      ? d.additionalEvidences.map((e) => ({
          type: e.type,
          pageNumber: typeof e.pageNumber === 'number' ? e.pageNumber : null,
          blockIndex: typeof e.blockIndex === 'number' ? e.blockIndex : null,
          timestamp: e.timestamp ?? null,
          quote: (e.quote || '').trim(),
          verified: Boolean(e.verified),
        })).sort((a, b) => (a.quote || '').localeCompare(b.quote || ''))
      : [],
    status: d.status || 'draft',
    isApproved: Boolean(d.isApproved),
    schemaVersion: 'v2',
  }));

  // Sort drafts deterministically by ID
  normalized.sort((a, b) => a.id.localeCompare(b.id));

  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Sanitizes a recovered draft to guarantee server-enforced safety:
 * - Drops unknown/arbitrary client properties
 * - Never allows client-dictated automatic approval (isApproved: false)
 * - Enforces server-verified materialId, subjectId, and domain
 */
export function sanitizeRecoveryDraft(
  draft: ConceptDraft,
  context: {
    materialId: string;
    subjectId: string;
    domain: 'math_stats' | 'computer_science';
    sourceMarkdownHash?: string;
    needsSourceReview?: boolean;
  }
): ConceptDraft {
  const sourceMarkdownHash = draft.sourceMarkdownHash || context.sourceMarkdownHash || '';
  const needsSourceReview =
    context.needsSourceReview !== undefined
      ? context.needsSourceReview
      : Boolean(draft.needsSourceReview);

  return {
    id: draft.id,
    materialId: context.materialId,
    subjectId: context.subjectId,
    title: (draft.title || '').trim(),
    domain: context.domain === 'computer_science' ? 'computer_science' : 'math_stats',
    description: (draft.description || '').trim(),
    coreDefinitionFormulaOrAlgorithm: (draft.coreDefinitionFormulaOrAlgorithm || '').trim(),
    prerequisites: Array.isArray(draft.prerequisites) ? draft.prerequisites.map((p) => String(p).trim()).filter(Boolean) : [],
    relatedConcepts: Array.isArray(draft.relatedConcepts) ? draft.relatedConcepts.map((r) => String(r).trim()).filter(Boolean) : [],
    commonMisconceptions: Array.isArray(draft.commonMisconceptions) ? draft.commonMisconceptions.map((m) => String(m).trim()).filter(Boolean) : [],
    examples: Array.isArray(draft.examples) ? draft.examples.map((ex) => String(ex).trim()).filter(Boolean) : [],
    sourceMarkdownHash,
    needsSourceReview,
    sourceEvidence: draft.sourceEvidence
      ? {
          type: draft.sourceEvidence.type,
          pageNumber: draft.sourceEvidence.pageNumber,
          blockIndex: draft.sourceEvidence.blockIndex,
          timestamp: draft.sourceEvidence.timestamp,
          quote: draft.sourceEvidence.quote,
          verified: Boolean(draft.sourceEvidence.verified),
        }
      : {
          type: 'page' as const,
          quote: '',
          verified: false,
        },
    additionalEvidences: Array.isArray(draft.additionalEvidences)
      ? draft.additionalEvidences.map((e) => ({
          type: e.type,
          pageNumber: e.pageNumber,
          blockIndex: e.blockIndex,
          timestamp: e.timestamp,
          quote: e.quote,
          verified: Boolean(e.verified),
        }))
      : undefined,
    isApproved: false, // Server safety invariant: client retry cannot forge approved status
    status: 'draft',
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Signs an AI chunk generation result into a tamper-proof recovery token.
 * Valid for 24 hours by default.
 */
export function signRecoveryToken(params: {
  userId: string;
  jobId: string;
  materialId: string;
  subjectId: string;
  domain: string;
  chunkIndex: number;
  markdownHash: string;
  modelId: string;
  drafts: ConceptDraft[];
  schemaVersion?: string;
  expiresInMs?: number;
}): string {
  const expiresAt = Date.now() + (params.expiresInMs ?? 24 * 60 * 60 * 1000);
  const draftsHash = computeDraftsHash(params.drafts);
  const schemaVersion = params.schemaVersion || 'v2';

  const payload: RecoveryTokenPayload = {
    userId: params.userId,
    jobId: params.jobId,
    materialId: params.materialId,
    subjectId: params.subjectId,
    domain: params.domain,
    chunkIndex: params.chunkIndex,
    markdownHash: params.markdownHash,
    modelId: params.modelId,
    draftsHash,
    schemaVersion,
    expiresAt,
  };

  const dataToSign = [
    payload.userId,
    payload.jobId,
    payload.materialId,
    payload.subjectId,
    payload.domain,
    payload.chunkIndex,
    payload.markdownHash,
    payload.modelId,
    payload.draftsHash,
    payload.schemaVersion,
    payload.expiresAt,
  ].join('|');

  const secret = getRecoverySecret();
  const hmac = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');

  const tokenObj = {
    p: payload,
    s: hmac,
  };

  return Buffer.from(JSON.stringify(tokenObj), 'utf-8').toString('base64url');
}

export type VerifyRecoveryTokenResult =
  | { ok: true; payload: RecoveryTokenPayload }
  | { ok: false; error: string; code: 'EXPIRED' | 'TAMPERED' | 'MISMATCH' | 'MALFORMED' | 'UNCONFIGURED' };

/**
 * Cryptographically verifies a recovery token against the caller context and draft content.
 */
export function verifyRecoveryToken(
  tokenStr: string,
  expected: {
    userId: string;
    jobId: string;
    materialId: string;
    subjectId?: string;
    domain: string;
    chunkIndex: number;
    markdownHash: string;
    modelId?: string;
    drafts: ConceptDraft[];
    now?: number;
  }
): VerifyRecoveryTokenResult {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return { ok: false, error: '복구 토큰이 제공되지 않았습니다.', code: 'MALFORMED' };
  }

  let secret: string;
  try {
    secret = getRecoverySecret();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '서버 복구 서명 비밀키 누락',
      code: 'UNCONFIGURED',
    };
  }

  let tokenObj: { p?: RecoveryTokenPayload; s?: string };
  try {
    const json = Buffer.from(tokenStr, 'base64url').toString('utf-8');
    tokenObj = JSON.parse(json);
  } catch {
    return { ok: false, error: '복구 토큰 형식이 올바르지 않습니다.', code: 'MALFORMED' };
  }

  if (!tokenObj.p || !tokenObj.s) {
    return { ok: false, error: '복구 토큰 필수 데이터가 누락되었습니다.', code: 'MALFORMED' };
  }

  const p = tokenObj.p;

  // 1. Verify HMAC signature first to prevent timing attacks or spoofing
  const dataToSign = [
    p.userId,
    p.jobId,
    p.materialId,
    p.subjectId,
    p.domain,
    p.chunkIndex,
    p.markdownHash,
    p.modelId,
    p.draftsHash,
    p.schemaVersion || 'v2',
    p.expiresAt,
  ].join('|');

  const expectedHmac = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');

  const hmacBuffer = Buffer.from(tokenObj.s, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');

  if (hmacBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(hmacBuffer, expectedBuffer)) {
    return { ok: false, error: '복구 토큰 서명이 위조되었거나 변조되었습니다.', code: 'TAMPERED' };
  }

  // 2. Check Expiration
  const currentTime = expected.now ?? Date.now();
  if (p.expiresAt < currentTime) {
    return { ok: false, error: '복구 토큰의 유효 기간이 만료되었습니다.', code: 'EXPIRED' };
  }

  // 3. Check Account Ownership (strict account isolation)
  if (p.userId !== expected.userId) {
    return { ok: false, error: '다른 사용자의 복구 토큰을 재사용할 수 없습니다.', code: 'MISMATCH' };
  }

  // 4. Check Job, Material, and Model context
  if (p.jobId !== expected.jobId) {
    return { ok: false, error: '다른 분석 작업의 복구 토큰입니다.', code: 'MISMATCH' };
  }

  if (p.materialId !== expected.materialId) {
    return { ok: false, error: '자료 식별자가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  if (expected.subjectId && p.subjectId !== expected.subjectId) {
    return { ok: false, error: '과목 식별자가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  if (p.domain !== expected.domain) {
    return { ok: false, error: '과목 학문 분야(domain)가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  if (p.chunkIndex !== expected.chunkIndex) {
    return { ok: false, error: '청크 번호가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  if (p.markdownHash !== expected.markdownHash) {
    return { ok: false, error: '자료 본문 해시가 일치하지 않습니다. 원본 본문이 변경되었습니다.', code: 'MISMATCH' };
  }

  if (expected.modelId && p.modelId !== expected.modelId) {
    return { ok: false, error: '작업의 AI 모델 식별자가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  // 5. Verify Drafts integrity: submitted drafts must match the exact drafts hash signed by the server
  const submittedDraftsHash = computeDraftsHash(expected.drafts);
  if (p.draftsHash !== submittedDraftsHash) {
    return {
      ok: false,
      error: '제출된 개념 초안 내용이 서버가 생성한 원본 결과와 일치하지 않습니다 (초안 변조 감지).',
      code: 'TAMPERED',
    };
  }

  return { ok: true, payload: p };
}

/**
 * Deterministically canonicalizes JSON for consistent hashing across object key permutations.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalizeJson(item))).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Computes deterministic SHA-256 hash of arbitrary task result object.
 */
export function computeTaskResultHash(result: unknown): string {
  if (result === null || result === undefined) return '';
  return crypto.createHash('sha256').update(canonicalizeJson(result)).digest('hex');
}

export interface TaskRecoveryTokenPayload {
  userId: string;
  taskId: string;
  taskType: string;
  inputIdentifier: string;
  resultHash: string;
  leaseToken?: string;
  modelId?: string;
  schemaVersion: string;
  expiresAt: number;
}

/**
 * Signs an AI task generation result into a tamper-proof recovery token.
 */
export function signTaskRecoveryToken(params: {
  userId: string;
  taskId: string;
  taskType: string;
  inputIdentifier: string;
  result: unknown;
  leaseToken?: string;
  modelId?: string;
  expiresInMs?: number;
  schemaVersion?: string;
}): string {
  const expiresAt = Date.now() + (params.expiresInMs ?? 24 * 60 * 60 * 1000);
  const resultHash = computeTaskResultHash(params.result);
  const schemaVersion = params.schemaVersion || 'v1';

  const payload: TaskRecoveryTokenPayload = {
    userId: params.userId,
    taskId: params.taskId,
    taskType: params.taskType,
    inputIdentifier: params.inputIdentifier,
    resultHash,
    leaseToken: params.leaseToken || '',
    modelId: params.modelId || '',
    schemaVersion,
    expiresAt,
  };

  const dataToSign = [
    payload.userId,
    payload.taskId,
    payload.taskType,
    payload.inputIdentifier,
    payload.resultHash,
    payload.leaseToken,
    payload.modelId,
    payload.schemaVersion,
    payload.expiresAt,
  ].join('|');

  const secret = getRecoverySecret();
  const hmac = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');

  const tokenObj = { p: payload, s: hmac };
  return Buffer.from(JSON.stringify(tokenObj), 'utf-8').toString('base64url');
}

export const CANONICAL_TASK_TYPES = {
  EVALUATE_ANSWER: 'evaluate_answer',
  LOGIC_QUESTIONS: 'logic_questions',
  TRANSFER_PROBLEM: 'transfer_problem',
  REVIEW_PROBLEM_QUALITY: 'review_problem_quality',
} as const;

export function isTaskTypeCompatible(tokenTaskType: string, expectedTaskType: string): boolean {
  if (tokenTaskType === expectedTaskType) return true;
  // Explicit restricted alias support for quality review tasks
  if (
    (tokenTaskType === 'problem_quality_review' && expectedTaskType === 'review_problem_quality') ||
    (tokenTaskType === 'review_problem_quality' && expectedTaskType === 'problem_quality_review')
  ) {
    return true;
  }
  return false;
}

export type VerifyTaskRecoveryTokenResult =
  | { ok: true; payload: TaskRecoveryTokenPayload }
  | { ok: false; error: string; code: 'EXPIRED' | 'TAMPERED' | 'MISMATCH' | 'MALFORMED' | 'UNCONFIGURED' };

/**
 * Cryptographically verifies a task recovery token against caller context and result content.
 */
export function verifyTaskRecoveryToken(
  tokenStr: string,
  expected: {
    userId: string;
    taskId: string;
    legacyTaskId?: string | string[];
    taskType: string;
    inputIdentifier: string;
    legacyInputIdentifier?: string | string[];
    result: unknown;
    now?: number;
  }
): VerifyTaskRecoveryTokenResult {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return { ok: false, error: '복구 토큰이 제공되지 않았습니다.', code: 'MALFORMED' };
  }

  let secret: string;
  try {
    secret = getRecoverySecret();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '서버 복구 서명 비밀키 누락',
      code: 'UNCONFIGURED',
    };
  }

  let tokenObj: { p?: TaskRecoveryTokenPayload; s?: string };
  try {
    const json = Buffer.from(tokenStr, 'base64url').toString('utf-8');
    tokenObj = JSON.parse(json);
  } catch {
    return { ok: false, error: '복구 토큰 형식이 올바르지 않습니다.', code: 'MALFORMED' };
  }

  if (!tokenObj.p || !tokenObj.s) {
    return { ok: false, error: '복구 토큰 필수 데이터가 누락되었습니다.', code: 'MALFORMED' };
  }

  const p = tokenObj.p;

  // 1. Verify HMAC signature first
  const dataToSign = [
    p.userId,
    p.taskId,
    p.taskType,
    p.inputIdentifier,
    p.resultHash,
    p.leaseToken || '',
    p.modelId || '',
    p.schemaVersion || 'v1',
    p.expiresAt,
  ].join('|');

  const expectedHmac = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');
  const hmacBuffer = Buffer.from(tokenObj.s, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');

  if (hmacBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(hmacBuffer, expectedBuffer)) {
    return { ok: false, error: '복구 토큰 서명이 위조되었거나 변조되었습니다.', code: 'TAMPERED' };
  }

  // 2. Check Expiration
  const currentTime = expected.now ?? Date.now();
  if (p.expiresAt < currentTime) {
    return { ok: false, error: '복구 토큰의 유효 기간이 만료되었습니다.', code: 'EXPIRED' };
  }

  // 3. Strict User Ownership Check
  if (p.userId !== expected.userId) {
    return { ok: false, error: '다른 사용자의 복구 토큰을 재사용할 수 없습니다.', code: 'MISMATCH' };
  }

  // 4. Task ID & Task Type Check
  const allowedTaskIds = [
    expected.taskId,
    ...(expected.legacyTaskId
      ? (Array.isArray(expected.legacyTaskId) ? expected.legacyTaskId : [expected.legacyTaskId])
      : []),
  ];
  if (!allowedTaskIds.includes(p.taskId)) {
    return { ok: false, error: '작업 식별자가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  if (!isTaskTypeCompatible(p.taskType, expected.taskType)) {
    return { ok: false, error: '작업 유형이 일치하지 않습니다.', code: 'MISMATCH' };
  }

  // 5. Input Identifier Check (matches authoritative SHA-256 or backward-compatible legacy hash)
  const legacyList = expected.legacyInputIdentifier
    ? (Array.isArray(expected.legacyInputIdentifier) ? expected.legacyInputIdentifier : [expected.legacyInputIdentifier])
    : [];
  const inputMatches =
    p.inputIdentifier === expected.inputIdentifier ||
    legacyList.some((leg) => leg && p.inputIdentifier === leg);
  if (!inputMatches) {
    return { ok: false, error: '작업 입력 식별자가 일치하지 않습니다.', code: 'MISMATCH' };
  }

  // 6. Verify Result Content Integrity
  const computedHash = computeTaskResultHash(expected.result);
  if (p.resultHash !== computedHash) {
    return { ok: false, error: '제출된 복구 결과 데이터가 서버가 서명한 원본과 일치하지 않습니다.', code: 'TAMPERED' };
  }

  return { ok: true, payload: p };
}
