import { Injectable } from '@nestjs/common';
import { Db } from '../db/db';
import { Errors } from '../common/errors';
import { enqueueEvent } from '../common/events';
import { AuctionRow, BidRow, toAuctionDto, toBidDto } from './auction.types';
import { AuctionScheduler } from './auction.scheduler';

export interface CreateAuctionInput {
  title: string;
  emoji?: string;
  startPrice: number;
  minStep: number;
  durationSec: number;
  antiSnipeSec?: number;
}

const SELECT_WITH_NAMES = `
  SELECT a.*, l.username AS leader_name, w.username AS winner_name
    FROM auctions a
    LEFT JOIN users l ON l.id = a.leader_id
    LEFT JOIN users w ON w.id = a.winner_id`;

@Injectable()
export class AuctionsService {
  constructor(
    private readonly db: Db,
    private readonly scheduler: AuctionScheduler,
  ) {}

  async list(status?: 'active' | 'finished') {
    const r = await this.db.query<AuctionRow>(
      `${SELECT_WITH_NAMES}
        WHERE ($1::auction_status IS NULL OR a.status = $1)
        ORDER BY a.status, CASE WHEN a.status = 'active' THEN a.ends_at END ASC, a.ends_at DESC
        LIMIT 100`,
      [status ?? null],
    );
    return r.rows.map(toAuctionDto);
  }

  async get(id: number) {
    const a = await this.db.one<AuctionRow>(`${SELECT_WITH_NAMES} WHERE a.id = $1`, [id]);
    if (!a) throw Errors.notFound('Auction');
    const bids = await this.db.query<BidRow & { username: string }>(
      `SELECT b.*, u.username FROM bids b JOIN users u ON u.id = b.user_id
        WHERE b.auction_id = $1 ORDER BY b.id DESC LIMIT 30`,
      [id],
    );
    return { auction: toAuctionDto(a), bids: bids.rows.map(toBidDto) };
  }

  async create(input: CreateAuctionInput, createdBy: number | null) {
    const dto = await this.db.tx(async (c) => {
      const a = (
        await c.query<AuctionRow>(
          `INSERT INTO auctions (title, emoji, start_price, min_step, ends_at, anti_snipe_sec, created_by)
           VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6, $7)
           RETURNING *`,
          [input.title, input.emoji ?? '🎁', input.startPrice, input.minStep, input.durationSec, input.antiSnipeSec ?? 30, createdBy],
        )
      ).rows[0];
      const dto = toAuctionDto(a);
      await enqueueEvent(c, 'auction.created', { auction: dto });
      return dto;
    });
    await this.scheduler.scheduleSettlement(dto.id, new Date(dto.endsAt));
    return dto;
  }
}
