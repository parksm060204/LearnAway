/**
 * Local persistence scope.
 *
 * Existing (pre-login) records live under the unprefixed "legacy" keys and are
 * never deleted or auto-attributed. Signed-in users read and write their own
 * namespaced keys, so records from another account are never shown.
 *
 * This only separates local browser storage. It is NOT server-side ownership;
 * see docs/auth-setup.md for the distinction.
 */

export type StorageScope =
  | { kind: 'user'; userId: string }
  | { kind: 'legacy' };

export const LEGACY_SCOPE: StorageScope = { kind: 'legacy' };
export const LEGACY_SCOPE_ID = 'shared';

export const LEGACY_KEY_PREFIX = 'redcall_';
export const USER_KEY_PREFIX = 'redcall_user_';

let currentScope: StorageScope = LEGACY_SCOPE;
const listeners = new Set<() => void>();

export function getStorageScope(): StorageScope {
  return currentScope;
}

/** Stable scope id for a user, independent of the currently active scope. */
export function userIdToScopeId(userId: string): string {
  return `u_${encodeURIComponent(userId)}`;
}

export function getStorageScopeId(): string {
  return currentScope.kind === 'user'
    ? userIdToScopeId(currentScope.userId)
    : LEGACY_SCOPE_ID;
}

function sameScope(a: StorageScope, b: StorageScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'user' && b.kind === 'user') return a.userId === b.userId;
  return true;
}

export function setStorageScope(scope: StorageScope): void {
  if (sameScope(currentScope, scope)) return;
  currentScope = scope;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // listeners are best-effort notifications
    }
  }
}

export function subscribeStorageScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Prefixes a stable base key (e.g. `subjects_v1`) with the active scope.
 * Legacy scope keeps the historical `redcall_...` keys unchanged.
 */
export function scopedStorageKey(baseKey: string): string {
  if (currentScope.kind === 'user') {
    return `redcall_user_${encodeURIComponent(currentScope.userId)}__${baseKey}`;
  }
  return `redcall_${baseKey}`;
}

/** The full localStorage prefix for the active scope. */
export function getScopedStoragePrefix(): string {
  if (currentScope.kind === 'user') {
    return `${USER_KEY_PREFIX}${encodeURIComponent(currentScope.userId)}__`;
  }
  return LEGACY_KEY_PREFIX;
}

/** True when a raw localStorage key belongs to a signed-in user namespace. */
export function isUserScopedStorageKey(rawKey: string): boolean {
  return rawKey.startsWith(USER_KEY_PREFIX);
}

/** True when a raw localStorage key belongs to the active scope. */
export function isKeyInActiveScope(rawKey: string): boolean {
  if (currentScope.kind === 'user') {
    return rawKey.startsWith(getScopedStoragePrefix());
  }
  return rawKey.startsWith(LEGACY_KEY_PREFIX) && !rawKey.startsWith(USER_KEY_PREFIX);
}
