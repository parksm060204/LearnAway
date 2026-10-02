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

let currentScope: StorageScope = LEGACY_SCOPE;
const listeners = new Set<() => void>();

export function getStorageScope(): StorageScope {
  return currentScope;
}

export function getStorageScopeId(): string {
  return currentScope.kind === 'user'
    ? `u_${encodeURIComponent(currentScope.userId)}`
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

/** True when a raw localStorage key belongs to a signed-in user namespace. */
export function isUserScopedStorageKey(rawKey: string): boolean {
  return rawKey.startsWith('redcall_user_');
}
