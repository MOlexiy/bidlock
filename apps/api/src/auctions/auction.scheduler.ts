import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { REDIS } from '../db/db.module';
import { SettlementService } from './settlement.service';

const QUEUE = 'auctions';

/**
 * Two layers, so an auction always closes:
 *  - a delayed "settle" job at ends_at (precise; re-queued if anti-sniping pushed the end);
 *  - a repeatable "sweep" job every 10s that settles anything overdue (survives lost jobs / Redis flush).
 * Settlement itself is idempotent, so duplicates from either layer are harmless.
 */
@Injectable()
export class AuctionScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AuctionScheduler.name);
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settlement: SettlementService,
  ) {
    this.queue = new Queue(QUEUE, { connection: redis });
  }

  async onApplicationBootstrap() {
    this.worker = new Worker(QUEUE, (job) => this.process(job), {
      connection: this.redis.duplicate(),
      concurrency: 10,
    });
    this.worker.on('failed', (job, err) => this.log.error(`job ${job?.name}#${job?.id} failed: ${err.message}`));
    await this.queue.upsertJobScheduler('sweep', { every: 10_000 }, { name: 'sweep' });
  }

  async scheduleSettlement(auctionId: number, endsAt: Date) {
    await this.queue.add(
      'settle',
      { auctionId },
      {
        delay: Math.max(0, endsAt.getTime() - Date.now()),
        // one job per (auction, end time): re-scheduling the same end is a no-op
        jobId: `settle-${auctionId}-${endsAt.getTime()}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  private async process(job: Job) {
    if (job.name === 'sweep') {
      const ids = await this.settlement.findOverdue();
      for (const id of ids) await this.settleOne(id);
      return { swept: ids.length };
    }
    return this.settleOne(job.data.auctionId as number);
  }

  private async settleOne(auctionId: number) {
    const r = await this.settlement.settle(auctionId);
    if (r.status === 'not_due') await this.scheduleSettlement(auctionId, r.endsAt);
    if (r.status === 'settled') this.log.log(`auction #${auctionId} settled, winner=${r.winnerId ?? '-'} price=${r.price ?? '-'}`);
    return r;
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }
}
