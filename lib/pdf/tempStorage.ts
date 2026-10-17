/**
 * Validation and security guards for temporary PDF conversion storage objects.
 * Prevents cross-user object deletion, path traversal, encoding exploits, and
 * accidental permanent material deletions.
 */

// Strict pattern for safe filenames: letters, digits, dots, underscores, hyphens
const SAFE_FILE_NAME_REGEX = /^[a-zA-Z0-9._-]{1,255}$/;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export interface TempPathValidationResult {
  valid: boolean;
  reason?: string;
  normalizedPath?: string;
}

/**
 * Validates that storagePath strictly conforms to:
 *   `<userId>/temp-convert/<jobId>/<safeFileName>`
 * and that userId and jobId strictly match the expected owner and job.
 * Rejects any relative traversal, url-encoding bypass, null bytes, backslashes,
 * or foreign/permanent storage paths.
 */
export function validateTempStoragePath(
  userId: string,
  jobId: string,
  storagePath: string
): TempPathValidationResult {
  if (!userId || !jobId || !storagePath) {
    return { valid: false, reason: 'MISSING_PARAMETERS' };
  }

  const uId = userId.trim();
  const jId = jobId.trim();
  const rawPath = storagePath.trim();

  if (!SAFE_ID_REGEX.test(uId)) {
    return { valid: false, reason: 'INVALID_USER_ID' };
  }
  if (!SAFE_ID_REGEX.test(jId)) {
    return { valid: false, reason: 'INVALID_JOB_ID' };
  }

  // Detect traversal, null bytes, backslashes, or URL encoded slashes
  if (
    rawPath.includes('\\') ||
    rawPath.includes('\0') ||
    rawPath.includes('..') ||
    /%2f/i.test(rawPath) ||
    /%5c/i.test(rawPath) ||
    /%2e/i.test(rawPath)
  ) {
    return { valid: false, reason: 'ILLEGAL_CHARACTERS_OR_TRAVERSAL' };
  }

  // Check decoded string as well to prevent double-encoding tricks
  try {
    const decoded = decodeURIComponent(rawPath);
    if (decoded.includes('\\') || decoded.includes('..') || decoded.includes('\0')) {
      return { valid: false, reason: 'DECODED_TRAVERSAL_DETECTED' };
    }
  } catch {
    return { valid: false, reason: 'MALFORMED_URI_ENCODING' };
  }

  const segments = rawPath.split('/');
  if (segments.length !== 4) {
    return { valid: false, reason: 'INVALID_SEGMENT_COUNT' };
  }

  const [pathUserId, fixedFolder, pathJobId, fileName] = segments;

  if (pathUserId !== uId) {
    return { valid: false, reason: 'USER_ID_MISMATCH' };
  }

  if (fixedFolder !== 'temp-convert') {
    return { valid: false, reason: 'INVALID_TEMP_FOLDER' };
  }

  if (pathJobId !== jId) {
    return { valid: false, reason: 'JOB_ID_MISMATCH' };
  }

  if (!fileName || fileName === '.' || fileName === '..' || !SAFE_FILE_NAME_REGEX.test(fileName)) {
    return { valid: false, reason: 'INVALID_FILE_NAME' };
  }

  // Must end with .pdf (case-insensitive)
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    return { valid: false, reason: 'INVALID_EXTENSION' };
  }

  // Cannot point to permanent materials directories
  const normalized = `${uId}/temp-convert/${jId}/${fileName}`;
  if (normalized !== rawPath) {
    return { valid: false, reason: 'CANONICAL_PATH_MISMATCH' };
  }

  return { valid: true, normalizedPath: normalized };
}

/**
 * Builds a canonical temporary PDF storage path for a given user and job.
 */
export function buildTempStoragePath(userId: string, jobId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const validName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  return `${userId}/temp-convert/${jobId}/${validName}`;
}
