import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/db/db';
import { BiddingService } from '../src/auctions/bidding.service';
import { assertInvariants, createAuction, createUser, freshDb, outcome, wallet } from './helpers';

let db: Db;
let bidding: BiddingService;

const bid = (userId: number, auctionId: number, amount: number, idempotencyKey: string = randomUUID()) =>
  bidding.placeBid({ userId, auctionId, amount, idempotencyKey });

beforeEach(async () => {
  await db?.close();
  db = await freshDb();
  bidding = new BiddingService(db);
});
afterAll(() => db?.close());

describe('bidding rules', () => {
  it('first bid at start price freezes the amount', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db, { startPrice: 100, minStep: 10 });

    const r = await bid(alice, lot, 100);

    expect(r.auction.currentPrice).toBe(100);
    expect(r.auction.minNextBid).toBe(110);
    expect(await wallet(db, alice)).toEqual({ balance: 900, frozen: 100 });
    await assertInvariants(db);
  });

  it('rejects bids below start price and below current + step', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const bob = await createUser(db, 'bob', 1000);
    const lot = await createAuction(db, { startPrice: 100, minStep: 10 });

    expect(await outcome(bid(alice, lot, 99))).toEqual({ ok: false, code: 'BID_TOO_LOW' });
    await bid(alice, lot, 100);
    expect(await outcome(bid(bob, lot, 109))).toEqual({ ok: false, code: 'BID_TOO_LOW' });
    expect(await wallet(db, bob)).toEqual({ balance: 1000, frozen: 0 });
  });

  it('outbidding releases the previous leader funds', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const bob = await createUser(db, 'bob', 1000);
    const lot = await createAuction(db, { startPrice: 100, minStep: 10 });

    await bid(alice, lot, 100);
    await bid(bob, lot, 150);

    expect(await wallet(db, alice)).toEqual({ balance: 1000, frozen: 0 });
    expect(await wallet(db, bob)).toEqual({ balance: 850, frozen: 150 });
    await assertInvariants(db);
  });

  it('raising your own leading bid only freezes the difference', async () => {
    const alice = await createUser(db, 'alice', 300);
    const lot = await createAuction(db, { startPrice: 100, minStep: 10 });

    await bid(alice, lot, 200);
    await bid(alice, lot, 300); // would fail if it tried to freeze 300 on top of 200

    expect(await wallet(db, alice)).toEqual({ balance: 0, frozen: 300 });
    await assertInvariants(db);
  });

  it('insufficient funds changes nothing and emits no events', async () => {
    const alice = await createUser(db, 'alice', 50);
    const lot = await createAuction(db, { startPrice: 100 });

    expect(await outcome(bid(alice, lot, 100))).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS' });
    expect(await wallet(db, alice)).toEqual({ balance: 50, frozen: 0 });
    expect((await db.query('SELECT * FROM outbox')).rowCount).toBe(0);
  });

  it('writes events in the same transaction as the bid', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const bob = await createUser(db, 'bob', 1000);
    const lot = await createAuction(db);
    await bid(alice, lot, 100);
    await db.query('DELETE FROM outbox');

    await bid(bob, lot, 110);

    const topics = (await db.query('SELECT topic FROM outbox ORDER BY id')).rows.map((r) => r.topic);
    expect(topics).toEqual(['auction.bid', 'wallet.updated', 'wallet.updated', 'user.outbid']);
  });

  it('anti-sniping: a bid in the last seconds extends the auction', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db, { endsInSec: 5, antiSnipeSec: 30 });

    const r = await bid(alice, lot, 100);

    const leftSec = (new Date(r.auction.endsAt).getTime() - Date.now()) / 1000;
    expect(leftSec).toBeGreaterThan(25);
  });

  it('rejects bids after the end time even before settlement ran', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db, { endsInSec: -1 });
    expect(await outcome(bid(alice, lot, 100))).toEqual({ ok: false, code: 'AUCTION_CLOSED' });
  });
});

describe('idempotency', () => {
  it('a retried request with the same key is applied once', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db);

    const first = await bid(alice, lot, 100, 'key-1');
    const retry = await bid(alice, lot, 100, 'key-1');

    expect(retry.replayed).toBe(true);
    expect(retry.bid.id).toBe(first.bid.id);
    expect(await wallet(db, alice)).toEqual({ balance: 900, frozen: 100 });
  });

  it('10 concurrent requests with the same key -> one bid, one freeze', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db);

    const results = await Promise.all(Array.from({ length: 10 }, () => bid(alice, lot, 100, 'same')));

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.bid.id)).size).toBe(1);
    expect(await wallet(db, alice)).toEqual({ balance: 900, frozen: 100 });
    await assertInvariants(db);
  });

  it('reusing a key for a different amount is rejected', async () => {
    const alice = await createUser(db, 'alice', 1000);
    const lot = await createAuction(db);
    await bid(alice, lot, 100, 'k');
    expect(await outcome(bid(alice, lot, 200, 'k'))).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });
});
