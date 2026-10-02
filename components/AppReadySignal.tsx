'use client';

import { useEffect } from 'react';
import { reportAppReady } from '../lib/appReadiness';

/**
 * Marks the current screen as initialized. Use on screens that have no
 * client-side data to load (gateway, configuration notices) so the splash can
 * close as soon as the page is interactive.
 */
export function AppReadySignal() {
  useEffect(() => {
    reportAppReady();
  }, []);
  return null;
}
