import crypto from 'node:crypto';

export interface JobTokenPayload {
  userId: string;
  jobId: string;
  maxPages: number;
  exp: number;
}

/**
 * Creates an HMAC-signed job token binding the user ID, job ID, and expiration.
 * Used for authenticated service-to-service communication between Next.js and the Python converter.
 */
export function createPdfJobToken(userId: string, jobId: string, maxPages = 250, ttlSeconds = 120): string | null {
  const secret = (process.env.PDF_CONVERT_SERVICE_TOKEN || '').trim();
  if (!secret) return null;

  const payload: JobTokenPayload = {
    userId,
    jobId,
    maxPages,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}
