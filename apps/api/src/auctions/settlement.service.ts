import { Injectable } from '@nestjs/common';
import { Db } from '../db/db';
import { enqueueEvent } from '../common/events';
import { AuctionRow, toAuctionDto } from './auction.types';

export type SettleResult =
  | { status: 'settled'; winnerId: number | null; price: number | null }
  | { status: 'not_due'; endsAt: Date }
  | { status: 'already_finished' }
  | { status: 'not_found' };

/**
 * Closes an auction. Safe to call any number of times, from any number of workers:
 * the auction row lock + status check make it idempotent, and the end time is re-read
 * under the lock, so an anti-snipe extension that just happened is respected.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly db: Db) {}

  settle(auctionId: number): Promise<SettleResult> {
    return this.db.tx(async (c) => {
      const a = (
        await c.query<AuctionRow & { due: boolean }>(
          'SELECT *, ends_at <= now() AS due FROM auctions WHERE id = $1 FOR UPDATE',
          [auctionId],
        )
      ).rows[0];
      if (!a) return { status: 'not_found' } as const;
      if (a.status !== 'active') return { status: 'already_finished' } as const;
      if (!a.due) return { status: 'not_due', endsAt: a.ends_at } as const;

      let winnerName: string | null = null;
      if (a.leader_id !== null && a.current_price !== null) {
        // Frozen funds become a charge: they leave the user's wallet for good.
        const w = (
          await c.query<{ id: number; username: string; balance: number; frozen: number }>(
            `UPDATE users SET frozen = frozen - $2 WHERE id = $1 RETURNING id, username, balance, frozen`,
            [a.leader_id, a.current_price],
          )
        ).rows[0];
        winnerName = w.username;
        await c.query(`INSERT INTO ledger (user_id, auction_id, kind, amount) VALUES ($1, $2, 'charge', $3)`, [
          a.leader_id,
          a.id,
          a.current_price,
        ]);
        await enqueueEvent(c, 'wallet.updated', { userId: w.id, balance: w.balance, frozen: w.frozen });
      }

      const done = (
        await c.query<AuctionRow>(
          `UPDATE auctions SET status = 'finished', winner_id = leader_id WHERE id = $1 RETURNING *`,
          [a.id],
        )
      ).rows[0];
      await enqueueEvent(c, 'auction.finished', {
        auction: toAuctionDto({ ...done, leader_name: winnerName, winner_name: winnerName }),
      });

      return { status: 'settled', winnerId: a.leader_id, price: a.current_price } as const;
    });
  }

  /** Ids of active auctions whose time is up. Used by the safety-net sweeper. */
  async findOverdue(limit = 100): Promise<number[]> {
    const r = await this.db.query<{ id: number }>(
      `SELECT id FROM auctions WHERE status = 'active' AND ends_at <= now() ORDER BY ends_at LIMIT $1`,
      [limit],
    );
    return r.rows.map((x) => x.id);
  }
}
