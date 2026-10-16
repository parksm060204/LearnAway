'use client';

import { useEffect, useCallback, useSyncExternalStore } from 'react';

export interface ClientTrialCreditState {
  loading: boolean;
  granted: number;
  balance: number;
  hasPersonalKey: boolean;
  error?: string | null;
}

const EVENT_NAME = 'trial-credits-changed';

let cachedState: ClientTrialCreditState = {
  loading: true,
  granted: 3,
  balance: 3,
  hasPersonalKey: false,
};

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function notifyTrialCreditsUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
  void fetchTrialCredits();
}

export async function fetchTrialCredits(): Promise<ClientTrialCreditState> {
  try {
    const res = await fetch('/api/trial-credits');
    const data = await res.json();
    if (res.ok && data.success) {
      cachedState = {
        loading: false,
        granted: data.granted ?? 3,
        balance: data.balance ?? 0,
        hasPersonalKey: Boolean(data.hasPersonalKey),
        error: null,
      };
    } else {
      cachedState = {
        ...cachedState,
        loading: false,
        error: data.error || '체험 크레딧 조회 실패',
      };
    }
  } catch {
    cachedState = {
      ...cachedState,
      loading: false,
      error: '네트워크 오류',
    };
  }
  emitChange();
  return cachedState;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  const handleUpdate = () => {
    void fetchTrialCredits();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(EVENT_NAME, handleUpdate);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener(EVENT_NAME, handleUpdate);
    }
  };
}

function getSnapshot(): ClientTrialCreditState {
  return cachedState;
}

function getServerSnapshot(): ClientTrialCreditState {
  return cachedState;
}

let initialFetchStarted = false;

export function useTrialCredits() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!initialFetchStarted) {
      initialFetchStarted = true;
      void fetchTrialCredits();
    }
  }, []);

  const reload = useCallback(async () => {
    await fetchTrialCredits();
  }, []);

  return { ...state, reload };
}

