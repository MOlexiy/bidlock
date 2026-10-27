import { formatLeft, useNow } from '../lib/clock';

export function Countdown({ endsAt, finished, warnSec = 30 }: { endsAt: string; finished: boolean; warnSec?: number }) {
  const now = useNow();
  if (finished) return <span className="countdown done">ended</span>;
  const left = new Date(endsAt).getTime() - now;
  const cls = left <= 0 ? 'closing' : left <= warnSec * 1000 ? 'hot' : '';
  return <span className={`countdown ${cls}`}>{left <= 0 ? 'closing…' : formatLeft(left)}</span>;
}
