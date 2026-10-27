import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '../config';
import { Db } from './db';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    { provide: Db, useFactory: () => new Db(config.databaseUrl) },
    { provide: REDIS, useFactory: () => new Redis(config.redisUrl, { maxRetriesPerRequest: null }) },
  ],
  exports: [Db, REDIS],
})
export class DbModule implements OnModuleDestroy {
  constructor(
    private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onModuleDestroy() {
    await this.db.close();
    this.redis.disconnect();
  }
}
