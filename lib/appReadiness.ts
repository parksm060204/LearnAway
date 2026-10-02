/**
 * Client-side application readiness store.
 *
 * Drives the splash screen: shown on every full page load until the current
 * screen reports that initialization finished. It is never reset during
 * client-side navigation, so the splash does not repeat between internal pages.
 *
 * Authentication itself is decided on the server; this store only coordinates
 * the client initialization handoff (hydration -> first data load).
 */

export type AppReadinessStatus = 'loading' | 'ready' | 'error';

export interface AppReadiness {
  status: AppReadinessStatus;
  message: string | null;
}

export const INITIAL_READINESS: AppReadiness = { status: 'loading', message: null };

let snapshot: AppReadiness = INITIAL_READINESS;
const listeners = new Set<() => void>();

function emit(next: AppReadiness): void {
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // listeners are best-effort notifications
    }
  }
}

export function reportAppReady(): void {
  if (snapshot.status === 'ready' && snapshot.message === null) return;
  emit({ status: 'ready', message: null });
}

export function reportAppError(message: string): void {
  emit({ status: 'error', message });
}

export function resetAppReadiness(): void {
  emit(INITIAL_READINESS);
}

export function getAppReadiness(): AppReadiness {
  return snapshot;
}

export function subscribeAppReadiness(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
