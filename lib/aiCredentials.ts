import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AI_CONFIG, isAiConfigured, type AiConfig } from './aiConfig';

/**
 * Server-only storage/encryption for per-user AI credentials.
 *
 * The plaintext key exists only in server memory: it is encrypted here before
 * being written, and decrypted only when a server route needs to call the
 * gateway. It is never returned to the browser and never stored in
 * localStorage.
 */

export const SCHOOL_GATEWAY_PROVIDER = 'school_gateway';
export const SCHOOL_GATEWAY_BASE_URL = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
export const DEFAULT_SCHOOL_MODEL = 'deepseek-v4.1-flash';

const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

/** Accepts a 32-byte key as base64, hex (64 chars) or raw 32 characters. */
export function parseEncryptionKey(raw?: string): Buffer | null {
  const value = (raw || '').trim();
  if (!value) return null;
  try {
    const buf = Buffer.from(value, 'base64');
    if (buf.length === KEY_BYTES) return buf;
  } catch {
    // fall through
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (Buffer.byteLength(value, 'utf8') === KEY_BYTES) return Buffer.from(value, 'utf8');
  return null;
}

export function getEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  return parseEncryptionKey(env.AI_CREDENTIAL_ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const iv = Buffer.from(secret.iv, 'base64');
  const tag = Buffer.from(secret.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Masked identifier shown in the UI; never the key itself. */
export function maskKey(key: string): string {
  const trimmed = (key || '').trim();
  if (trimmed.length <= 4) return '••••';
  if (trimmed.length <= 12) return `••••${trimmed.slice(-4)}`;
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/** Builds the AI config for a user's decrypted key. Base URL is fixed here. */
export function buildSchoolConfig(apiKey: string, model?: string): AiConfig {
  const minRaw = Number(process.env.BAZE_MIN_OUTPUT_TOKENS);
  return {
    provider: SCHOOL_GATEWAY_PROVIDER,
    apiKey,
    model: (model || '').trim() || DEFAULT_SCHOOL_MODEL,
    apiBase: SCHOOL_GATEWAY_BASE_URL,
    minOutputTokens: Number.isFinite(minRaw) && minRaw > 0 ? minRaw : 16000,
    jsonMode: process.env.BAZE_JSON_MODE === 'json_object' ? 'json_object' : 'none',
  };
}

/** Maps a gateway check reason to a stable client error code. */
export function reasonToCode(reason: string): string {
  switch (reason) {
    case 'auth': return 'AUTH';
    case 'credit': return 'CREDIT';
    case 'forbidden': return 'FORBIDDEN';
    case 'rate_limit': return 'RATE_LIMIT';
    case 'provider': return 'PROVIDER';
    case 'network': return 'NETWORK';
    case 'not_found': return 'MODEL_NOT_FOUND';
    case 'not_configured': return 'NOT_CONFIGURED';
    default: return 'UNKNOWN';
  }
}

export function connectionCheckHttpStatus(reason: string): number {
  if (reason === 'rate_limit') return 429;
  if (reason === 'credit') return 402;
  if (reason === 'auth' || reason === 'forbidden' || reason === 'not_found') return 400;
  return 502;
}

export type ModelSelection =
  | { ok: true; model: string }
  | { ok: false; code: 'NO_MODELS' | 'MODEL_NOT_AVAILABLE' };

/** Picks a verified model: explicit choice, else the preferred, else the first. */
export function selectAvailableModel(
  models: string[],
  requested?: string,
  preferred: string = DEFAULT_SCHOOL_MODEL
): ModelSelection {
  if (models.length === 0) return { ok: false, code: 'NO_MODELS' };
  if (requested) {
    return models.includes(requested) ? { ok: true, model: requested } : { ok: false, code: 'MODEL_NOT_AVAILABLE' };
  }
  return { ok: true, model: models.includes(preferred) ? preferred : models[0] };
}

export type ApiKeyValidation =
  | { ok: true; apiKey: string }
  | { ok: false; code: 'EMPTY_KEY' | 'BAD_REQUEST'; message: string };

export function validateApiKeyInput(value: unknown, maxLength = 512): ApiKeyValidation {
  const apiKey = typeof value === 'string' ? value.trim() : '';
  if (!apiKey) return { ok: false, code: 'EMPTY_KEY', message: 'API 키를 입력해 주세요.' };
  if (apiKey.length > maxLength) return { ok: false, code: 'BAD_REQUEST', message: 'API 키 형식이 올바르지 않습니다.' };
  return { ok: true, apiKey };
}

export interface ConnectionSecretData {
  provider?: string;
  base_url?: string;
  model?: string;
  key_hint?: string;
  ciphertext?: string;
  iv?: string;
  tag?: string;
}

export type AiConfigResolution =
  | { ok: true; config: AiConfig; source: 'user' | 'operator' }
  | { ok: false; code: 'no_credentials' | 'credential_error' | 'encryption_not_configured'; message: string };

/**
 * Resolves the AI config for a request.
 *
 * Order:
 *  1. the user's registered connection (decrypted server-side);
 *  2. the operator's global key, ONLY when the user has no connection.
 * A present-but-unusable user connection is an error: we never silently switch
 * to the operator key (or any other paid provider).
 */
export async function resolveAiConfigForUser(userId?: string): Promise<AiConfigResolution> {
  if (userId) {
    let secret: ConnectionSecretData | null = null;
    try {
      const { createClient } = await import('./supabase/server');
      const supabase = await createClient();
      const { data, error } = await supabase.rpc('get_ai_connection_secret');
      if (!error) secret = (data ?? null) as ConnectionSecretData | null;
    } catch {
      secret = null;
    }
    if (secret && secret.ciphertext) {
      const key = getEncryptionKey();
      if (!key) {
        return {
          ok: false,
          code: 'encryption_not_configured',
          message: '서버 암호화 키(AI_CREDENTIAL_ENCRYPTION_KEY)가 설정되지 않아 저장된 API 연결을 사용할 수 없습니다.',
        };
      }
      try {
        const apiKey = decryptSecret(
          { ciphertext: secret.ciphertext, iv: secret.iv || '', tag: secret.tag || '' },
          key
        );
        return { ok: true, source: 'user', config: buildSchoolConfig(apiKey, secret.model) };
      } catch {
        return {
          ok: false,
          code: 'credential_error',
          message: '저장된 API 키를 복호화하지 못했습니다. 설정에서 키를 다시 등록해 주세요.',
        };
      }
    }
  }

  if (isAiConfigured()) return { ok: true, source: 'operator', config: AI_CONFIG };
  return {
    ok: false,
    code: 'no_credentials',
    message: 'AI API 연결이 필요합니다. 설정 > 내 AI API 연결에서 학교 BAZE API 키를 등록해 주세요.',
  };
}
