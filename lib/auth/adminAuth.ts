/**
 * Server-side Admin User Verification
 *
 * Implements strict, server-verified administrator authorization:
 * 1. Default deny: If no admin is configured in server env, no user is granted admin privileges.
 * 2. Admin status is determined SOLELY by server environment variables:
 *    - ADMIN_USER_IDS: comma-separated list of user UUIDs / IDs
 *    - ADMIN_EMAILS: comma-separated list of administrator email addresses
 * 3. Client parameters, headers, and mutable user_metadata are NEVER trusted for admin status.
 */

export interface AdminAuthUser {
  id: string;
  email?: string | null;
}

/**
 * Returns true only if the user is explicitly designated as an administrator
 * in the server environment variables.
 */
export function isServerAdminUser(user: AdminAuthUser | null | undefined): boolean {
  if (!user || !user.id || typeof user.id !== 'string') {
    return false;
  }

  const rawAdminUserIds = process.env.ADMIN_USER_IDS || '';
  const rawAdminEmails = process.env.ADMIN_EMAILS || '';

  const adminUserIds = rawAdminUserIds
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const adminEmails = rawAdminEmails
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // If server admin configuration is completely absent/empty, fail-safe to false.
  if (adminUserIds.length === 0 && adminEmails.length === 0) {
    return false;
  }

  const normalizedUserId = user.id.trim().toLowerCase();
  if (adminUserIds.includes(normalizedUserId)) {
    return true;
  }

  if (user.email && typeof user.email === 'string') {
    const normalizedEmail = user.email.trim().toLowerCase();
    if (adminEmails.includes(normalizedEmail)) {
      return true;
    }
  }

  return false;
}
