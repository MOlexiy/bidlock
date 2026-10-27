import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Db, isUniqueViolation } from '../db/db';
import { Errors } from '../common/errors';
import { enqueueEvent } from '../common/events';
import { AuctionRow, BidRow, minNextBid, toAuctionDto, toBidDto } from './auction.types';

export interface PlaceBidInput {
  userId: number;
  auctionId: number;
  amount: number;
  idempotencyKey: string;
}

export interface PlaceBidResult {
  bid: ReturnType<typeof toBidDto>;
  auction: ReturnType<typeof toAuctionDto>;
  /** true when the same idempotency key was replayed: nothing was charged twice. */
  replayed: boolean;
}

/**
 * The whole point of the project.
 *
 * Concurrency strategy (no sleeps, no retries-until-it-works):
 *  1. `SELECT ... FOR UPDATE` on the auction row serialises all bids for ONE auction.
 *     Bids on different auctions still run in parallel.
 *  2. Money moves with conditional updates (`WHERE balance >= $n`), so a balance can never go
 *     negative even if a check is skipped; a CHECK constraint is the last line of defence.
 *  3. User rows are locked in ascending id order. A bid touches two users (new leader and the
 *     outbid one); two auctions with the same pair of users in opposite roles would otherwise
 *     deadlock.
 *  4. Idempotency key (UNIQUE(user_id, key)) makes client retries safe.
 *  5. Events go to the outbox in the same transaction, so WebSocket clients never see a bid
 *     that was rolled back, and never miss one that was committed.
 */
@Injectable()
export class BiddingService {
  constructor(private readonly db: Db) {}

  async placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
    try {
      return await this.db.tx((c) => this.placeBidTx(c, input));
    } catch (err) {
      // Two concurrent requests with the same key on *different* auctions: the loser lands here.
      if (isUniqueViolation(err, 'bids_idempotency')) return this.replay(input);
      throw err;
    }
  }

  private async placeBidTx(c: PoolClient, { userId, auctionId, amount, idempotencyKey }: PlaceBidInput) {
    const auction = (
      await c.query<AuctionRow & { expired: boolean }>(
        `SELECT *, ends_at <= now() AS expired FROM auctions WHERE id = $1 FOR UPDATE`,
        [auctionId],
      )
    ).rows[0];
    if (!auction) throw Errors.notFound('Auction');

    // Checked *after* taking the lock: a retry that was queued behind its own first attempt sees it here.
    const existing = await this.findByKey(c, userId, idempotencyKey);
    if (existing) {
      if (existing.auction_id !== auctionId || existing.amount !== amount) throw Errors.idempotencyConflict();
      return { bid: toBidDto(existing), auction: toAuctionDto(auction), replayed: true };
    }

    if (auction.status !== 'active' || auction.expired) throw Errors.auctionClosed();

    const min = minNextBid(auction);
    if (amount < min) throw Errors.bidTooLow(min);

    const prevLeaderId = auction.leader_id;
    const prevPrice = auction.current_price ?? 0;
    const selfRaise = prevLeaderId === userId;

    // Deterministic lock order across all transactions -> no deadlocks between auctions.
    const userIds = [...new Set([userId, prevLeaderId].filter((x): x is number => x !== null))].sort((a, b) => a - b);
    await c.query('SELECT id FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE', [userIds]);

    // Raising your own leading bid only freezes the difference.
    const toFreeze = selfRaise ? amount - prevPrice : amount;
    const frozen = await c.query<{ id: number; balance: number; frozen: number }>(
      `UPDATE users SET balance = balance - $2, frozen = frozen + $2
        WHERE id = $1 AND balance >= $2
        RETURNING id, balance, frozen`,
      [userId, toFreeze],
    );
    if (frozen.rowCount === 0) {
      const u = (await c.query<{ balance: number }>('SELECT balance FROM users WHERE id = $1', [userId])).rows[0];
      if (!u) throw Errors.notFound('User');
      throw Errors.insufficientFunds(toFreeze, u.balance);
    }
    await c.query(`INSERT INTO ledger (user_id, auction_id, kind, amount) VALUES ($1, $2, 'freeze', $3)`, [
      userId,
      auctionId,
      toFreeze,
    ]);
    const wallets = [frozen.rows[0]];

    if (prevLeaderId !== null && !selfRaise) {
      const released = await c.query<{ id: number; balance: number; frozen: number }>(
        `UPDATE users SET balance = balance + $2, frozen = frozen - $2 WHERE id = $1 RETURNING id, balance, frozen`,
        [prevLeaderId, prevPrice],
      );
      await c.query(`INSERT INTO ledger (user_id, auction_id, kind, amount) VALUES ($1, $2, 'unfreeze', $3)`, [
        prevLeaderId,
        auctionId,
        prevPrice,
      ]);
      wallets.push(released.rows[0]);
    }

    const bid = (
      await c.query<BidRow>(
        `INSERT INTO bids (auction_id, user_id, amount, idempotency_key) VALUES ($1, $2, $3, $4) RETURNING *`,
        [auctionId, userId, amount, idempotencyKey],
      )
    ).rows[0];

    // Anti-sniping: a bid in the last N seconds pushes the end to now() + N.
    const updated = (
      await c.query<AuctionRow>(
        `UPDATE auctions
            SET current_price = $2,
                leader_id = $3,
                bids_count = bids_count + 1,
                ends_at = GREATEST(ends_at, now() + make_interval(secs => anti_snipe_sec))
          WHERE id = $1
          RETURNING *`,
        [auctionId, amount, userId],
      )
    ).rows[0];

    const names = await c.query<{ id: number; username: string }>('SELECT id, username FROM users WHERE id = ANY($1)', [
      userIds,
    ]);
    const nameOf = (id: number) => names.rows.find((r) => r.id === id)?.username ?? null;

    const auctionDto = toAuctionDto({ ...updated, leader_name: nameOf(userId) });
    const bidDto = toBidDto({ ...bid, username: nameOf(userId) ?? undefined });
    const extended = updated.ends_at.getTime() > auction.ends_at.getTime();

    await enqueueEvent(c, 'auction.bid', { auction: auctionDto, bid: bidDto, extended });
    for (const w of wallets) {
      await enqueueEvent(c, 'wallet.updated', { userId: w.id, balance: w.balance, frozen: w.frozen });
    }
    if (prevLeaderId !== null && !selfRaise) {
      await enqueueEvent(c, 'user.outbid', {
        userId: prevLeaderId,
        auctionId,
        title: updated.title,
        amount,
        by: nameOf(userId),
      });
    }

    return { bid: bidDto, auction: auctionDto, replayed: false };
  }

  private async findByKey(c: Pick<PoolClient, 'query'>, userId: number, key: string) {
    return (
      await c.query<BidRow & { username: string }>(
        `SELECT b.*, u.username FROM bids b JOIN users u ON u.id = b.user_id
          WHERE b.user_id = $1 AND b.idempotency_key = $2`,
        [userId, key],
      )
    ).rows[0];
  }

  private async replay({ userId, auctionId, amount, idempotencyKey }: PlaceBidInput): Promise<PlaceBidResult> {
    const existing = await this.findByKey(this.db.pool, userId, idempotencyKey);
    if (!existing || existing.auction_id !== auctionId || existing.amount !== amount) throw Errors.idempotencyConflict();
    const auction = await this.db.one<AuctionRow>('SELECT * FROM auctions WHERE id = $1', [auctionId]);
    return { bid: toBidDto(existing), auction: toAuctionDto(auction!), replayed: true };
  }
}
