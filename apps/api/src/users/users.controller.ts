import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { config } from '../config';
import { Db } from '../db/db';
import { Errors } from '../common/errors';
import { enqueueEvent } from '../common/events';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';

const FAUCET_AMOUNT = 5_000;

@Controller('me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly db: Db) {}

  @Get()
  async me(@CurrentUser() userId: number) {
    const u = await this.db.one('SELECT id, username, balance, frozen FROM users WHERE id = $1', [userId]);
    if (!u) throw Errors.notFound('User');
    return u;
  }

  /** Dev-only top-up. Goes through the ledger and the outbox like any real deposit would. */
  @Post('faucet')
  faucet(@CurrentUser() userId: number) {
    if (!config.allowDevLogin) throw new ForbiddenException();
    return this.db.tx(async (c) => {
      const u = (
        await c.query(
          'UPDATE users SET balance = balance + $2 WHERE id = $1 RETURNING id, username, balance, frozen',
          [userId, FAUCET_AMOUNT],
        )
      ).rows[0];
      if (!u) throw Errors.notFound('User');
      await c.query(`INSERT INTO ledger (user_id, kind, amount) VALUES ($1, 'deposit', $2)`, [userId, FAUCET_AMOUNT]);
      await enqueueEvent(c, 'wallet.updated', { userId, balance: u.balance, frozen: u.frozen });
      return u;
    });
  }
}
