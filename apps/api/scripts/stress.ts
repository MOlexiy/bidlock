/**
 * HTTP + WebSocket stress test against a running API.
 *   npm run stress -- --users 30 --bids 600 [--auction 1] [--url http://localhost:3000]
 * Creates a fresh auction (unless --auction is given), fires all bids at once through REST,
 * listens on WebSocket, and checks: accepted bids == bid events received, final price == max accepted.
 */
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
const BASE = args.url ?? 'http://localhost:3000';
const USERS = Number(args.users ?? 30);
const BIDS = Number(args.bids ?? 600);

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: res.status, body: (await res.json()) as T };
}

(async () => {
  const tokens = await Promise.all(
    Array.from({ length: USERS }, async (_, i) =>
      (await api<{ token: string }>('/auth/dev', { method: 'POST', body: JSON.stringify({ username: `stress_${i}` }) })).body.token,
    ),
  );

  let auctionId = args.auction ? Number(args.auction) : 0;
  if (!auctionId) {
    const { body } = await api<{ id: number }>('/auctions', {
      method: 'POST',
      token: tokens[0],
      body: JSON.stringify({ title: `Stress lot ${new Date().toISOString().slice(11, 19)}`, emoji: '🔥', startPrice: 10, minStep: 1, durationSec: 300 }),
    });
    auctionId = body.id;
  }

  const socket = io(BASE, { transports: ['websocket'] });
  const seen = new Set<number>();
  socket.on('auction.bid', (p: { auction: { id: number }; bid: { id: number } }) => {
    if (p.auction.id === auctionId) seen.add(p.bid.id);
  });
  await new Promise<void>((r) => socket.on('connect', () => r()));

  const statuses: Record<string, number> = {};
  const accepted: number[] = [];
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: BIDS }, async (_, i) => {
      const amount = 10 + Math.floor(Math.random() * 5000);
      const r = await api<{ error?: string; bid?: { amount: number } }>(`/auctions/${auctionId}/bids`, {
        method: 'POST',
        token: tokens[i % USERS],
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({ amount }),
      });
      const key = r.status === 201 ? 'accepted' : (r.body.error ?? String(r.status));
      statuses[key] = (statuses[key] ?? 0) + 1;
      if (r.status === 201) accepted.push(r.body.bid!.amount);
    }),
  );
  const ms = performance.now() - t0;

  await new Promise((r) => setTimeout(r, 1500)); // let the outbox relay catch up
  const { body } = await api<{ auction: { currentPrice: number; bidsCount: number } }>(`/auctions/${auctionId}`);
  socket.close();

  const maxAccepted = Math.max(...accepted);
  const ok = body.auction.currentPrice === maxAccepted && seen.size === accepted.length && body.auction.bidsCount >= accepted.length;

  console.table(statuses);
  console.log(`${BIDS} bids in ${ms.toFixed(0)} ms (${((BIDS / ms) * 1000).toFixed(0)} req/s), auction #${auctionId}`);
  console.log(`final price ${body.auction.currentPrice}, max accepted ${maxAccepted}`);
  console.log(`websocket bid events ${seen.size} / accepted ${accepted.length}`);
  console.log(ok ? '✅ consistent' : '❌ INCONSISTENT');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
