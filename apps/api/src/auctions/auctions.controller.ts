import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuctionsService } from './auctions.service';
import { BiddingService } from './bidding.service';

const coins = z.number().int().positive().max(1_000_000_000);

const CreateAuction = z.object({
  title: z.string().trim().min(1).max(80),
  emoji: z.string().max(8).optional(),
  startPrice: coins,
  minStep: coins,
  durationSec: z.number().int().min(10).max(7 * 24 * 3600),
  antiSnipeSec: z.number().int().min(0).max(300).optional(),
});
const PlaceBid = z.object({ amount: coins });
const ListQuery = z.object({ status: z.enum(['active', 'finished']).optional() });

@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly bidding: BiddingService,
  ) {}

  @Get()
  async list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return { items: await this.auctions.list(q.status), serverTime: new Date().toISOString() };
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return { ...(await this.auctions.get(id)), serverTime: new Date().toISOString() };
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@CurrentUser() userId: number, @Body(new ZodPipe(CreateAuction)) body: z.infer<typeof CreateAuction>) {
    return this.auctions.create(body, userId);
  }

  /** Send an `Idempotency-Key` header to make retries safe; without one every request is a new bid. */
  @Post(':id/bids')
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async bid(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) auctionId: number,
    @Body(new ZodPipe(PlaceBid)) body: z.infer<typeof PlaceBid>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.bidding.placeBid({
      userId,
      auctionId,
      amount: body.amount,
      idempotencyKey: idempotencyKey?.slice(0, 100) || randomUUID(),
    });
  }
}
