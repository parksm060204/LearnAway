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
  expiresAt: number; // Unix timestamp in ms
}

/**
 * Returns a stable, internal HMAC secret derived from server environment variables.
 */
function getRecoverySecret(): string {
  const secret =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    'redcall_recovery_internal_hmac_secret_2026';
  return secret;
}

/**
 * Deterministically computes a SHA-256 hash of a list of ConceptDrafts.
 * Normalizes title, description, core definition, and evidence to prevent tampering.
 */
export function computeDraftsHash(drafts: ConceptDraft[]): string {
  const normalized = drafts.map((d) => ({
    id: d.id,
    title: d.title.trim(),
    domain: d.domain,
    description: d.description.trim(),
    coreDef: (d.coreDefinitionFormulaOrAlgorithm || '').trim(),
    prereqs: [...(d.prerequisites || [])].sort(),
    related: [...(d.relatedConcepts || [])].sort(),
    misconceptions: [...(d.commonMisconceptions || [])].sort(),
    examples: [...(d.examples || [])].sort(),
    sourceEvidence: {
      type: d.sourceEvidence?.type,
      pageNumber: d.sourceEvidence?.pageNumber,
      blockIndex: d.sourceEvidence?.blockIndex,
      quote: d.sourceEvidence?.quote?.trim(),
    },
  }));

  // Sort drafts deterministically by ID
  normalized.sort((a, b) => a.id.localeCompare(b.id));

  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
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
  expiresInMs?: number;
}): string {
  const expiresAt = Date.now() + (params.expiresInMs ?? 24 * 60 * 60 * 1000);
  const draftsHash = computeDraftsHash(params.drafts);

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
    payload.expiresAt,
  ].join('|');

  const hmac = crypto.createHmac('sha256', getRecoverySecret()).update(dataToSign).digest('hex');

  const tokenObj = {
    p: payload,
    s: hmac,
  };

  return Buffer.from(JSON.stringify(tokenObj), 'utf-8').toString('base64url');
}

export type VerifyRecoveryTokenResult =
  | { ok: true; payload: RecoveryTokenPayload }
  | { ok: false; error: string; code: 'EXPIRED' | 'TAMPERED' | 'MISMATCH' | 'MALFORMED' };

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
    drafts: ConceptDraft[];
    now?: number;
  }
): VerifyRecoveryTokenResult {
  if (!tokenStr || typeof tokenStr !== 'string') {
    return { ok: false, error: '복구 토큰이 제공되지 않았습니다.', code: 'MALFORMED' };
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
    p.expiresAt,
  ].join('|');

  const expectedHmac = crypto.createHmac('sha256', getRecoverySecret()).update(dataToSign).digest('hex');

  const hmacBuffer = Buffer.from(tokenObj.s, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');

  if (hmacBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(hmacBuffer, expectedBuffer)) {
    return { ok: false, error: '복구 토큰 서명이 위조되었거나 변조되었습니다.', code: 'TAMPERED' };
  }

  // 2. Check Expiration
  const currentTime = expected.now ?? Date.now();
  if (p.expiresAt < currentTime) {
    return { ok: false, error: '복구 토큰의 유효 기간(24시간)이 만료되었습니다.', code: 'EXPIRED' };
  }

  // 3. Check Account Ownership (strict account isolation)
  if (p.userId !== expected.userId) {
    return { ok: false, error: '다른 사용자의 복구 토큰을 재사용할 수 없습니다.', code: 'MISMATCH' };
  }

  // 4. Check Job and Material context
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

  // 5. Verify Drafts integrity: the submitted drafts must match the exact drafts hash signed by the server
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
