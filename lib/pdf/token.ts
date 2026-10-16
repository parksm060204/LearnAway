import crypto from 'node:crypto';

export interface JobTokenPayload {
  userId: string;
  jobId: string;
  storagePath?: string;
  maxPages: number;
  exp: number;
}

/**
 * Creates an HMAC-signed job token binding the user ID, job ID, storage path, and expiration.
 * The signature is computed over the Base64URL-encoded JSON payload string.
 * Used for authenticated service-to-service communication between Next.js and the Python converter.
 */
export function createPdfJobToken(
  userId: string,
  jobId: string,
  maxPages = 250,
  ttlSeconds = 120,
  storagePath?: string
): string | null {
  const secret = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
  if (!secret) return null;

  const payload: JobTokenPayload = {
    userId,
    jobId,
    maxPages,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  if (storagePath) {
    payload.storagePath = storagePath;
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64, 'ascii').digest('hex');
  return `${payloadB64}.${signature}`;
}

export function verifyPdfJobToken(
  token: string,
  expected?: { userId?: string; jobId?: string; storagePath?: string }
): JobTokenPayload | null {
  const secret = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
  if (!secret || !token || !token.includes('.')) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64, 'ascii').digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadRaw) as JobTokenPayload;
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.userId !== 'string' || typeof payload.jobId !== 'string' || typeof payload.exp !== 'number') {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    if (expected?.userId && payload.userId !== expected.userId) return null;
    if (expected?.jobId && payload.jobId !== expected.jobId) return null;
    if (expected?.storagePath && payload.storagePath && payload.storagePath !== expected.storagePath) return null;

    return payload;
  } catch {
    return null;
  }
}
