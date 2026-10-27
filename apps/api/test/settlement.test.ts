import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/db/db';
import { BiddingService } from '../src/auctions/bidding.service';
import { SettlementService } from '../src/auctions/settlement.service';
import { assertInvariants, createAuction, createUser, freshDb, outcome, wallet } from './helpers';

let db: Db;
let bidding: BiddingService;
let settlement: SettlementService;

beforeEach(async () => {
  await db?.close();
  db = await freshDb();
  bidding = new BiddingService(db);
  settlement = new SettlementService(db);
});
afterAll(() => db?.close());

const expire = (id: number) => db.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, [id]);

describe('settlement', () => {
  it('charges the winner and finishes the auction', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const bob = await createUser(db, 'bob', 1000);
    const lot = await createAuction(db);
    await bidding.placeBid({ userId: alice, auctionId: lot, amount: 100, idempotencyKey: randomUUID() });
    await bidding.placeBid({ userId: bob, auctionId: lot, amount: 200, idempotencyKey: randomUUID() });
    await expire(lot);

    expect(await settlement.settle(lot)).toEqual({ status: 'settled', winnerId: bob, price: 200 });

    expect(await wallet(db, bob)).toEqual({ balance: 800, frozen: 0 });
    expect(await wallet(db, alice)).toEqual({ balance: 1000, frozen: 0 });
    expect(await db.one('SELECT status, winner_id FROM auctions WHERE id = $1', [lot])).toEqual({
      status: 'finished',
      winner_id: bob,
    });
    await assertInvariants(db);
  });

  it('does nothing before the end time', async () => {
    const lot = await createAuction(db, { endsInSec: 60 });
    expect((await settlement.settle(lot)).status).toBe('not_due');
  });

  it('is idempotent under concurrent workers', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db);
    await bidding.placeBid({ userId: alice, auctionId: lot, amount: 100, idempotencyKey: randomUUID() });
    await expire(lot);

    const results = await Promise.all(Array.from({ length: 10 }, () => settlement.settle(lot)));

    expect(results.filter((r) => r.status === 'settled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_finished')).toHaveLength(9);
    expect(await wallet(db, alice)).toEqual({ balance: 900, frozen: 0 });
    await assertInvariants(db);
  });

  it('a bid racing with settlement either lands before close or is rejected', async () => {
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser(db, `u${i}`, 10_000)));
    const lot = await createAuction(db, { startPrice: 1, minStep: 1 });
    await bidding.placeBid({ userId: users[0], auctionId: lot, amount: 1, idempotencyKey: randomUUID() });
    await expire(lot);

    const [settled, ...bids] = await Promise.all([
      settlement.settle(lot),
      ...users.map((u, i) => outcome(bidding.placeBid({ userId: u, auctionId: lot, amount: 10 + i, idempotencyKey: randomUUID() }))),
    ]);

    expect(settled.status).toBe('settled');
    expect(bids.every((b) => !b.ok && b.code === 'AUCTION_CLOSED')).toBe(true);
    await assertInvariants(db);
  });

  it('auction without bids finishes with no winner', async () => {
    const lot = await createAuction(db);
    await expire(lot);
    expect(await settlement.settle(lot)).toEqual({ status: 'settled', winnerId: null, price: null });
  });
});
