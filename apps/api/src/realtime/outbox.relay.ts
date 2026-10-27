import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { Client } from 'pg';
import { config } from '../config';
import { Db } from '../db/db';
import { REDIS } from '../db/db.module';
import { EVENTS_CHANNEL, OutboxEvent } from '../common/events';

/**
 * Relays committed outbox rows to Redis pub/sub.
 * - Woken by `LISTEN outbox` (trigger on insert) for low latency, with a 1s poll as a fallback.
 * - `FOR UPDATE SKIP LOCKED` lets several API instances drain the same table without double-sending
 *   or blocking each other. Delivery is at-least-once; clients dedupe by `bidsCount`.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(OutboxRelay.name);
  private listener?: Client;
  private timer?: NodeJS.Timeout;
  private running = false;
  private pending = false;

  constructor(
    private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap() {
    this.listener = new Client({ connectionString: config.databaseUrl });
    await this.listener.connect();
    this.listener.on('notification', () => void this.drain());
    this.listener.on('error', (e) => this.log.error(`listener: ${e.message}`));
    await this.listener.query('LISTEN outbox');
    this.timer = setInterval(() => void this.drain(), 1000);
    void this.drain();
  }

  async drain(): Promise<number> {
    if (this.running) {
      this.pending = true;
      return 0;
    }
    this.running = true;
    let total = 0;
    try {
      do {
        this.pending = false;
        let n: number;
        do {
          n = await this.drainBatch();
          total += n;
        } while (n > 0);
      } while (this.pending);
    } catch (e) {
      this.log.error(`drain failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return total;
  }

  private drainBatch(batch = 200) {
    return this.db.tx(async (c) => {
      const rows = (
        await c.query<OutboxEvent>(
          `SELECT id, topic, payload FROM outbox
            WHERE published_at IS NULL
            ORDER BY id
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [batch],
        )
      ).rows;
      if (rows.length === 0) return 0;
      const pipeline = this.redis.pipeline();
      for (const r of rows) pipeline.publish(EVENTS_CHANNEL, JSON.stringify(r));
      await pipeline.exec();
      await c.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
      return rows.length;
    });
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
  }
}
