/**
 * Stage 13/14: Persistence for answer-logic strengthening sessions and delayed
 * rechallenge reservations. Drafts survive a refresh; save failures are reported
 * to the caller instead of being silently swallowed.
 */

import { LogicStrengthenSession, RechallengeReservation } from './types';

const LOGIC_KEY = 'redcall_logic_sessions_v1';
const RESERVATION_KEY = 'redcall_rechallenge_reservations_v1';
const ACTIVE_SESSION_KEY = 'redcall_logic_active_sessions_v1';

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

/** All strengthening sessions created from a given source Attempt, newest first. */
export function loadLogicSessionsForAttempt(attemptId: string): LogicStrengthenSession[] {
  return loadLogicSessions()
    .filter((s) => s.sourceAttemptId === attemptId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getActiveLogicSessionId(attemptId: string): string | null {
  const map = safeGet<Record<string, string>>(ACTIVE_SESSION_KEY, {});
  return map[attemptId] || null;
}

export function setActiveLogicSessionId(attemptId: string, sessionId: string): boolean {
  const map = safeGet<Record<string, string>>(ACTIVE_SESSION_KEY, {});
  return safeSet(ACTIVE_SESSION_KEY, { ...map, [attemptId]: sessionId });
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

export type ReservationCompletionStatus =
  | 'completed'
  | 'already_completed'
  | 'not_found'
  | 'cancelled'
  | 'mismatch'
  | 'save_failed';

export interface ReservationCompletionResult {
  status: ReservationCompletionStatus;
  reservations: RechallengeReservation[];
  message: string;
}

/** Attempt identity used to validate a reservation before completion. */
export interface ReservationAttemptIdentity {
  subjectId: string;
  conceptId: string;
  problemId: string;
  problemVersion?: number;
}

/**
 * Single source of truth for reservation validation, shared by the UI submit
 * path and the automatic recovery path.
 */
export function validateReservationForAttempt(
  reservation: RechallengeReservation | null,
  attempt: ReservationAttemptIdentity
): { ok: boolean; reason?: ReservationCompletionStatus; message?: string } {
  if (!reservation) return { ok: false, reason: 'not_found', message: '재도전 예약을 찾을 수 없습니다.' };
  if (reservation.status === 'cancelled') {
    return { ok: false, reason: 'cancelled', message: '취소된 예약은 완료 처리할 수 없습니다.' };
  }
  if (reservation.status === 'completed') {
    return { ok: false, reason: 'already_completed', message: '이미 완료된 예약입니다.' };
  }
  if (
    reservation.subjectId !== attempt.subjectId ||
    reservation.conceptId !== attempt.conceptId ||
    reservation.problemId !== attempt.problemId ||
    reservation.problemVersion !== (attempt.problemVersion ?? 1)
  ) {
    return {
      ok: false,
      reason: 'mismatch',
      message: '재도전 예약 정보(과목·개념·문제·버전)가 현재 풀이와 일치하지 않습니다.',
    };
  }
  return { ok: true };
}

export function completeRechallengeReservation(
  reservationId: string,
  attempt?: ReservationAttemptIdentity
): ReservationCompletionResult {
  const reservations = loadRechallengeReservations();
  const reservation = reservations.find((r) => r.id === reservationId) || null;

  if (!reservation) {
    return { status: 'not_found', reservations, message: '재도전 예약을 찾을 수 없습니다.' };
  }
  if (attempt) {
    const check = validateReservationForAttempt(reservation, attempt);
    if (!check.ok) {
      return { status: check.reason || 'mismatch', reservations, message: check.message || '예약을 완료할 수 없습니다.' };
    }
  } else {
    if (reservation.status === 'cancelled') {
      return { status: 'cancelled', reservations, message: '취소된 예약은 완료 처리할 수 없습니다.' };
    }
    if (reservation.status === 'completed') {
      return { status: 'already_completed', reservations, message: '이미 완료된 예약입니다.' };
    }
  }

  const { reservations: updated, saved } = updateRechallengeReservation(reservationId, {
    status: 'completed',
  });
  if (!saved) {
    return { status: 'save_failed', reservations: loadRechallengeReservations(), message: '예약 완료 저장에 실패했습니다.' };
  }
  return { status: 'completed', reservations: updated, message: '예약이 완료 처리되었습니다.' };
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
