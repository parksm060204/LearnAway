/**
 * Stage 13/14: Persistence for answer-logic strengthening sessions and delayed
 * rechallenge reservations. Drafts survive a refresh; save failures are reported
 * to the caller instead of being silently swallowed.
 */

import { LogicStrengthenSession, RechallengeReservation } from './types';

const LOGIC_KEY = 'redcall_logic_sessions_v1';
const RESERVATION_KEY = 'redcall_rechallenge_reservations_v1';

const inMemory: Record<string, string> = {};

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw =
      typeof window !== 'undefined' && window.localStorage
        ? localStorage.getItem(key)
        : inMemory[key];
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet<T>(key: string, value: T): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(key, serialized);
    } else {
      inMemory[key] = serialized;
    }
    return true;
  } catch {
    return false;
  }
}

export function loadLogicSessions(): LogicStrengthenSession[] {
  const loaded = safeGet<LogicStrengthenSession[]>(LOGIC_KEY, []);
  return Array.isArray(loaded) ? loaded : [];
}

export function getLogicSession(sessionId: string): LogicStrengthenSession | null {
  return loadLogicSessions().find((s) => s.id === sessionId) || null;
}

export function saveLogicSession(session: LogicStrengthenSession): boolean {
  const others = loadLogicSessions().filter((s) => s.id !== session.id);
  return safeSet(LOGIC_KEY, [session, ...others]);
}

export function deleteLogicSession(sessionId: string): boolean {
  return safeSet(LOGIC_KEY, loadLogicSessions().filter((s) => s.id !== sessionId));
}

export function loadRechallengeReservations(): RechallengeReservation[] {
  const loaded = safeGet<RechallengeReservation[]>(RESERVATION_KEY, []);
  return Array.isArray(loaded) ? loaded : [];
}

export function getRechallengeReservation(reservationId: string): RechallengeReservation | null {
  return loadRechallengeReservations().find((r) => r.id === reservationId) || null;
}

export function saveRechallengeReservation(reservation: RechallengeReservation): boolean {
  const others = loadRechallengeReservations().filter((r) => r.id !== reservation.id);
  return safeSet(RESERVATION_KEY, [reservation, ...others]);
}

/** Returns the updated list plus whether the write actually persisted. */
export function updateRechallengeReservation(
  reservationId: string,
  patch: Partial<RechallengeReservation>
): { reservations: RechallengeReservation[]; saved: boolean } {
  const updated = loadRechallengeReservations().map((r) =>
    r.id === reservationId ? { ...r, ...patch } : r
  );
  const saved = safeSet(RESERVATION_KEY, updated);
  return { reservations: updated, saved };
}

export function completeRechallengeReservation(reservationId: string): {
  reservations: RechallengeReservation[];
  saved: boolean;
} {
  return updateRechallengeReservation(reservationId, { status: 'completed' });
}

export function cancelRechallengeReservation(reservationId: string): {
  reservations: RechallengeReservation[];
  saved: boolean;
} {
  return updateRechallengeReservation(reservationId, { status: 'cancelled' });
}

export function clearLogicData(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LOGIC_KEY);
  localStorage.removeItem(RESERVATION_KEY);
}
