import { useEffect, useState } from 'react';

/** Server-client clock offset, so countdowns are right even if the device clock is off. */
let offsetMs = 0;
export const syncClock = (serverTime: string) => {
  offsetMs = new Date(serverTime).getTime() - Date.now();
};
export const serverNow = () => Date.now() + offsetMs;

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function formatLeft(ms: number) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

export const coins = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');
