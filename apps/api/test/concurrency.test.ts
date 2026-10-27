import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/db/db';
import { BiddingService } from '../src/auctions/bidding.service';
import { assertInvariants, createAuction, createUser, freshDb, outcome } from './helpers';

/**
 * These tests fire many bids at once through a 20-connection pool, so Postgres really
 * executes them concurrently. Any lost update, double freeze or deadlock shows up as either
 * a thrown (non-domain) error or a broken invariant.
 */
let db: Db;
let bidding: BiddingService;

beforeEach(async () => {
  await db?.close();
  db = await freshDb(20);
  bidding = new BiddingService(db);
});
afterAll(() => db?.close());

const rnd = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

describe('concurrent bidding', () => {
  it('300 simultaneous bids from 30 users on one lot keep money consistent', async () => {
    const users = await Promise.all(Array.from({ length: 30 }, (_, i) => createUser(db, `u${i}`, rnd(200, 2000))));
    const lot = await createAuction(db, { startPrice: 10, minStep: 1 });

    const results = await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        outcome(
          bidding.placeBid({
            userId: users[i % users.length],
            auctionId: lot,
            amount: rnd(10, 2000),
            idempotencyKey: randomUUID(),
          }),
        ),
      ),
    );

    const accepted = results.filter((r) => r.ok).length;
    const codes = new Set(results.flatMap((r) => (r.ok ? [] : [r.code])));
    expect(accepted).toBeGreaterThan(0);
    expect([...codes].every((c) => c === 'BID_TOO_LOW' || c === 'INSUFFICIENT_FUNDS')).toBe(true);
    await assertInvariants(db);

    // exactly one user holds frozen money: the leader
    const holders = await db.query('SELECT id, frozen FROM users WHERE frozen > 0');
    const lead = await db.one('SELECT leader_id, current_price FROM auctions WHERE id = $1', [lot]);
    expect(holders.rows).toEqual([{ id: lead.leader_id, frozen: lead.current_price }]);
  });

  it('a racing "everyone bids the same amount" lets exactly one win', async () => {
    const users = await Promise.all(Array.from({ length: 50 }, (_, i) => createUser(db, `u${i}`, 1000)));
    const lot = await createAuction(db, { startPrice: 100, minStep: 10 });

    const results = await Promise.all(
      users.map((u) => outcome(bidding.placeBid({ userId: u, auctionId: lot, amount: 100, idempotencyKey: randomUUID() }))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'BID_TOO_LOW')).toHaveLength(49);
    await assertInvariants(db);
  });

  it('one user spamming bids on many lots cannot spend more than their balance', async () => {
    const whale = await createUser(db, 'whale', 1000);
    const lots = await Promise.all(Array.from({ length: 20 }, () => createAuction(db, { startPrice: 100, minStep: 10 })));

    // 20 bids of 100 = 2000 wanted, only 1000 available
    const results = await Promise.all(
      lots.map((lot) => outcome(bidding.placeBid({ userId: whale, auctionId: lot, amount: 100, idempotencyKey: randomUUID() }))),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.filter((r) => !r.ok && r.code === 'INSUFFICIENT_FUNDS')).toHaveLength(10);
    await assertInvariants(db);
  });

  it('cross-auction outbids do not deadlock (users locked in id order)', async () => {
    // Classic deadlock shape: on lot A bob outbids alice, on lot B alice outbids bob — at the same time.
    // Each transaction must lock both users. Without a global lock order this deadlocks (40P01).
    const users = await Promise.all(Array.from({ length: 4 }, (_, i) => createUser(db, `u${i}`, 1_000_000)));
    const lots = await Promise.all(Array.from({ length: 4 }, () => createAuction(db, { startPrice: 1, minStep: 1 })));

    const rounds = 40;
    let price = 1;
    for (let round = 0; round < rounds; round++) {
      price += 1;
      // every lot gets a bid from a different user than its current leader, all in parallel
      await Promise.all(
        lots.map((lot, i) =>
          outcome(
            bidding.placeBid({
              userId: users[(i + round) % users.length],
              auctionId: lot,
              amount: price,
              idempotencyKey: randomUUID(),
            }),
          ),
        ),
      );
    }
    // also a fully random storm
    await Promise.all(
      Array.from({ length: 400 }, () =>
        outcome(
          bidding.placeBid({
            userId: users[rnd(0, 3)],
            auctionId: lots[rnd(0, 3)],
            amount: rnd(price, price + 500),
            idempotencyKey: randomUUID(),
          }),
        ),
      ),
    );
    // reaching this line means no 40P01 was thrown (outcome() re-throws non-domain errors)
    await assertInvariants(db);
  });
});
