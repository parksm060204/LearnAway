import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface GoogleDriveConfig {
  configured: boolean;
  encryptionConfigured?: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
export const REQUIRED_DRIVE_SCOPES = `${DRIVE_FILE_SCOPE} ${USERINFO_EMAIL_SCOPE}`;

export const DRIVE_SESSION_COOKIE_NAME = 'learnaway_drive_session';
export const DRIVE_STATE_COOKIE_NAME = 'learnaway_drive_state';

export type DriveErrorCode =
  | 'AUTH_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'STORAGE_FULL'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface DriveErrorDetails {
  code: DriveErrorCode;
  message: string;
  statusCode?: number;
}

export interface DriveSessionData {
  userId: string;
  googleEmail: string;
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
  refreshToken?: string;
  lastBackup?: {
    timestamp: string;
    fileId: string;
    fileName: string;
    completeness: 'complete' | 'partial';
    totalMaterials: number;
    withFiles: number;
  };
}

export interface OAuthStatePayload {
  userId: string;
  timestamp: number;
  nonce: string;
}

/**
 * Derives a secure 32-byte encryption key strictly from AI_CREDENTIAL_ENCRYPTION_KEY.
 * Falls back to NULL if not configured (never uses fixed public fallback string).
 */
export function getDriveEncryptionKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const explicitKey = (env.AI_CREDENTIAL_ENCRYPTION_KEY || '').trim();
  if (!explicitKey) return null;

  try {
    const buf = Buffer.from(explicitKey, 'base64');
    if (buf.length === 32) return buf;
  } catch {
    // fall through
  }
  if (/^[0-9a-fA-F]{64}$/.test(explicitKey)) {
    return Buffer.from(explicitKey, 'hex');
  }
  if (Buffer.byteLength(explicitKey, 'utf8') === 32) {
    return Buffer.from(explicitKey, 'utf8');
  }

  return null;
}

/**
 * Returns Google Drive API configuration from environment variables.
 * Requires both valid OAuth credentials and a valid 32-byte encryption key.
 */
export function getGoogleDriveConfig(env: Record<string, string | undefined> = process.env): GoogleDriveConfig {
  const clientId = (env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  const redirectUri = (env.GOOGLE_DRIVE_REDIRECT_URI || '').trim() || 'http://localhost:3000/api/drive/callback';
  const encryptionKey = getDriveEncryptionKey(env);
  const encryptionConfigured = Boolean(encryptionKey);

  const configured = Boolean(clientId && clientSecret && redirectUri && encryptionConfigured);
  return {
    configured,
    encryptionConfigured,
    clientId,
    clientSecret,
    redirectUri,
  };
}

/**
 * Encrypts arbitrary text using AES-256-GCM with server encryption key.
 * Returns null if server encryption key is unconfigured.
 */
export function encryptPayload(plaintext: string): string | null {
  const key = getDriveEncryptionKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts text encrypted by encryptPayload.
 * Returns null on decryption or integrity check failure or if encryption key is unconfigured.
 */
export function decryptPayload(packed: string): string | null {
  try {
    const parts = packed.split(':');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const key = getDriveEncryptionKey();
    if (!key) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Creates a signed CSRF state token for OAuth.
 */
export function createOAuthState(userId: string): string | null {
  const payload: OAuthStatePayload = {
    userId,
    timestamp: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  };
  return encryptPayload(JSON.stringify(payload));
}

/**
 * Verifies a CSRF state token.
 */
export function verifyOAuthState(state: string, expectedUserId?: string): { valid: boolean; userId?: string } {
  const decrypted = decryptPayload(state);
  if (!decrypted) return { valid: false };

  try {
    const payload = JSON.parse(decrypted) as OAuthStatePayload;
    if (!payload.userId || !payload.timestamp) return { valid: false };

    // State is valid for 15 minutes
    if (Date.now() - payload.timestamp > 15 * 60 * 1000) {
      return { valid: false };
    }

    if (expectedUserId && payload.userId !== expectedUserId) {
      return { valid: false };
    }

    return { valid: true, userId: payload.userId };
  } catch {
    return { valid: false };
  }
}

/**
 * Builds the Google OAuth 2.0 authorization URL.
 */
export function buildGoogleOAuthUrl(config: GoogleDriveConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: REQUIRED_DRIVE_SCOPES,
    access_type: 'offline', // permits obtaining refresh_token for manual backups
    prompt: 'consent',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for access & refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  config: GoogleDriveConfig
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
  const params = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google OAuth 토큰 교환 실패 (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Refreshes an expired access token using the refresh token.
 */
export async function refreshGoogleAccessToken(
  refreshToken: string,
  config: GoogleDriveConfig
): Promise<{ accessToken: string; expiresIn: number }> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google 토큰 갱신 실패 (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Fetches the user's Google account email.
 */
export async function fetchGoogleUserEmail(accessToken: string): Promise<string> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google 사용자 정보 조회 실패 (${response.status})`);
  }

  const data = (await response.json()) as { email?: string };
  if (!data.email) {
    throw new Error('Google 계정 이메일을 확인할 수 없습니다.');
  }

  return data.email;
}

/**
 * Categorizes an HTTP response or error from Google Drive API.
 */
export function categorizeDriveError(statusCode: number, responseText?: string): DriveErrorDetails {
  if (statusCode === 401) {
    return {
      code: 'AUTH_EXPIRED',
      message: 'Google Drive 인증이 만료되었거나 연결이 해제되었습니다. Google 계정을 다시 연결해 주세요.',
      statusCode,
    };
  }

  if (statusCode === 403) {
    if (responseText && (responseText.includes('storageQuotaExceeded') || responseText.includes('quotaExceeded'))) {
      return {
        code: 'STORAGE_FULL',
        message: 'Google Drive 저장 공간이 부족합니다. 드라이브 용량을 확보한 후 다시 시도해 주세요.',
        statusCode,
      };
    }
    if (responseText && (responseText.includes('userRateLimitExceeded') || responseText.includes('rateLimitExceeded'))) {
      return {
        code: 'RATE_LIMIT',
        message: 'Google Drive API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        statusCode,
      };
    }
    return {
      code: 'PERMISSION_DENIED',
      message: 'Google Drive 파일 생성 권한이 거부되었거나 drive.file 범위가 승인되지 않았습니다.',
      statusCode,
    };
  }

  if (statusCode === 429) {
    return {
      code: 'RATE_LIMIT',
      message: 'Google Drive API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
      statusCode,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: `Google Drive 요청 실패 (${statusCode}): ${responseText || '상태를 확인할 수 없습니다.'}`,
    statusCode,
  };
}

/**
 * Finds or creates the dedicated "LearnAway Backups" folder in Google Drive.
 * Uses appProperties to uniquely identify the folder without public sharing.
 */
export async function findOrCreateBackupFolder(accessToken: string): Promise<string> {
  // Query existing folder with learnawayApp property
  const query = encodeURIComponent(
    "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='learnawayApp' and value='true' }"
  );
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,appProperties)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    const text = await searchRes.text();
    const error = categorizeDriveError(searchRes.status, text);
    throw new Error(error.message);
  }

  const searchData = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (searchData.files && searchData.files.length > 0 && searchData.files[0].id) {
    return searchData.files[0].id;
  }

  // Create folder if not found
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'LearnAway Backups',
      mimeType: 'application/vnd.google-apps.folder',
      description: 'LearnAway 학습 자료 백업 전용 폴더입니다.',
      appProperties: {
        learnawayApp: 'true',
        role: 'backup_root',
      },
    }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    const error = categorizeDriveError(createRes.status, text);
    throw new Error(error.message);
  }

  const createData = (await createRes.json()) as { id: string };
  return createData.id;
}

/**
 * Checks if a backup with the given jobId already exists in the backup folder (idempotency guard).
 * Throws on API/network errors rather than falsely assuming the file does not exist.
 */
export async function findExistingBackupByJobId(
  accessToken: string,
  folderId: string,
  jobId: string
): Promise<{ id: string; name: string } | null> {
  const query = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and appProperties has { key='jobId' and value='${jobId}' }`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    const error = categorizeDriveError(res.status, text);
    throw new Error(`Google Drive 파일 조회 실패 (${res.status}): ${error.message}`);
  }
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  if (data.files && data.files.length > 0 && data.files[0].id) {
    return data.files[0];
  }
  return null;
}

export interface ResumableSessionOptions {
  fileName: string;
  totalBytes: number;
  jobId: string;
  completeness: 'complete' | 'partial';
  totalMaterials: number;
  withFiles: number;
}

/**
 * Creates a resumable upload session on Google Drive.
 * Returns the official Google Drive resumable upload URI.
 */
export async function createResumableUploadSession(
  accessToken: string,
  folderId: string,
  options: ResumableSessionOptions
): Promise<string> {
  const metadata = {
    name: options.fileName,
    parents: [folderId],
    mimeType: 'application/json',
    description: `LearnAway 자료 백업 (${options.completeness === 'complete' ? '완전 백업' : '부분 백업'})`,
    appProperties: {
      learnawayApp: 'true',
      jobId: options.jobId,
      completeness: options.completeness,
      totalMaterials: String(options.totalMaterials),
      withFiles: String(options.withFiles),
    },
  };

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/json',
      'X-Upload-Content-Length': String(options.totalBytes),
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const text = await res.text();
    const error = categorizeDriveError(res.status, text);
    throw new Error(error.message);
  }

  const location = res.headers.get('Location') || res.headers.get('location');
  if (!location) {
    throw new Error('Google Drive로부터 재개 가능한 업로드 세션 주소를 받지 못했습니다.');
  }

  return location;
}

export interface ChunkUploadResult {
  complete: boolean;
  fileId?: string;
  fileName?: string;
  range?: string | null;
}

/**
 * Streams a chunk to the Google Drive resumable upload URI.
 * Validates the URI domain strictly to prevent SSRF.
 */
export async function uploadResumableChunk(
  resumableUri: string,
  chunkBuffer: Buffer,
  rangeStart: number,
  rangeEnd: number,
  totalBytes: number
): Promise<ChunkUploadResult> {
  if (!resumableUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
    throw new Error('유효하지 않은 Google Drive 업로드 대상 주소입니다.');
  }

  const res = await fetch(resumableUri, {
    method: 'PUT',
    headers: {
      'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${totalBytes}`,
      'Content-Length': String(chunkBuffer.length),
      'Content-Type': 'application/json',
    },
    body: new Uint8Array(chunkBuffer),
  });

  if (res.status === 308) {
    return {
      complete: false,
      range: res.headers.get('Range') || res.headers.get('range'),
    };
  }

  if (res.status === 200 || res.status === 201) {
    const data = (await res.json()) as { id: string; name: string };
    return {
      complete: true,
      fileId: data.id,
      fileName: data.name,
    };
  }

  const text = await res.text();
  const error = categorizeDriveError(res.status, text);
  throw new Error(error.message);
}

export interface UploadBackupOptions {
  fileName: string;
  content: string;
  jobId: string;
  completeness: 'complete' | 'partial';
  totalMaterials: number;
  withFiles: number;
}

export interface UploadBackupResult {
  ok: boolean;
  fileId?: string;
  fileName?: string;
  timestamp?: string;
  error?: DriveErrorDetails;
}

/**
 * Uploads a backup file into the user's LearnAway backup folder on Google Drive.
 */
export async function uploadBackupToDrive(
  accessToken: string,
  folderId: string,
  options: UploadBackupOptions
): Promise<UploadBackupResult> {
  // 1. Check idempotency
  if (options.jobId) {
    const existing = await findExistingBackupByJobId(accessToken, folderId, options.jobId);
    if (existing) {
      return {
        ok: true,
        fileId: existing.id,
        fileName: existing.name,
        timestamp: new Date().toISOString(),
      };
    }
  }

  const metadata = {
    name: options.fileName,
    parents: [folderId],
    mimeType: 'application/json',
    description: `LearnAway 자료 백업 (${options.completeness === 'complete' ? '완전 백업' : '부분 백업'})`,
    appProperties: {
      learnawayApp: 'true',
      jobId: options.jobId,
      completeness: options.completeness,
      totalMaterials: String(options.totalMaterials),
      withFiles: String(options.withFiles),
    },
  };

  const contentBuffer = Buffer.from(options.content, 'utf8');
  const boundary = `-------LearnAwayBoundary${randomBytes(8).toString('hex')}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartBody = Buffer.concat([
    Buffer.from(
      `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`
    ),
    Buffer.from(`${delimiter}Content-Type: application/json\r\n\r\n`),
    contentBuffer,
    Buffer.from(closeDelimiter),
  ]);

  try {
    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(multipartBody.length),
      },
      body: multipartBody,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      const error = categorizeDriveError(uploadRes.status, text);
      return { ok: false, error };
    }

    const data = (await uploadRes.json()) as { id: string; name: string };
    return {
      ok: true,
      fileId: data.id,
      fileName: data.name || options.fileName,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? `네트워크 오류: ${err.message}` : '네트워크 오류가 발생했습니다.',
      },
    };
  }
}
