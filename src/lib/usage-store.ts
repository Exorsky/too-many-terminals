/**
 * The official rate-limit percentages, polled once for the whole app. The
 * title-bar meter and Home's Rate limit panel both read this, so they can't
 * disagree — before, Home fetched once on mount and kept "unavailable" if that
 * one read came back empty, while the meter's timer had long since recovered.
 */
import { useEffect, useState } from 'react';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import type { SessionUsageStats } from '@/types';

let latest: SessionUsageStats | null = null;
const listeners = new Set<(s: SessionUsageStats) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let periodMs = 0;

function fetchNow() {
  ipc.getSessionUsageStats()
    .then((s) => { latest = s; listeners.forEach((l) => l(s)); })
    .catch(() => {});
}

/** The latest usage read; starts polling with the first reader and stops with the last. */
export function useUsageStats(): SessionUsageStats | null {
  const { usageRefreshSeconds } = useSettings();
  const [stats, setStats] = useState(latest);
  useEffect(() => {
    listeners.add(setStats);
    // Floor of 5s guards against a corrupt/zero setting spinning the timer.
    const ms = Math.max(5, usageRefreshSeconds) * 1000;
    if (!timer || ms !== periodMs) {
      if (timer) clearInterval(timer);
      periodMs = ms;
      timer = setInterval(fetchNow, ms);
      fetchNow();
    } else if (latest) {
      setStats(latest);
    }
    return () => {
      listeners.delete(setStats);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, [usageRefreshSeconds]);
  return stats;
}

/** Test-only: forget the last read and stop polling. */
export function resetUsageForTest(): void {
  latest = null;
  listeners.clear();
  if (timer) clearInterval(timer);
  timer = null;
  periodMs = 0;
}
