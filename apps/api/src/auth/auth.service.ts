import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { Db } from '../db/db';
import { verifyInitData } from './telegram';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async devLogin(username: string) {
    if (!config.allowDevLogin) throw new ForbiddenException('Dev login is disabled');
    const id = await this.upsertUser({ username, tgId: null });
    return this.issue(id);
  }

  async telegramLogin(initData: string) {
    if (!config.telegramBotToken) throw new ForbiddenException('Telegram auth is not configured');
    const tg = verifyInitData(initData, config.telegramBotToken);
    if (!tg) throw new UnauthorizedException('Invalid initData');
    const id = await this.upsertUser({ username: tg.username ?? `tg${tg.id}`, tgId: tg.id });
    return this.issue(id);
  }

  /** New users get a starting balance; the deposit is written to the ledger like any other money move. */
  private async upsertUser({ username, tgId }: { username: string; tgId: number | null }) {
    return this.db.tx(async (c) => {
      const existing = (
        await c.query<{ id: number }>(
          tgId ? 'SELECT id FROM users WHERE tg_id = $1' : 'SELECT id FROM users WHERE username = $1 AND tg_id IS NULL',
          [tgId ?? username],
        )
      ).rows[0];
      if (existing) return existing.id;
      const u = (
        await c.query<{ id: number }>(
          `INSERT INTO users (username, tg_id, balance) VALUES ($1, $2, $3)
           ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username || '_' || floor(random() * 1e4)::int
           RETURNING id`,
          [username, tgId, config.startingBalance],
        )
      ).rows[0];
      await c.query(`INSERT INTO ledger (user_id, kind, amount) VALUES ($1, 'deposit', $2)`, [u.id, config.startingBalance]);
      return u.id;
    });
  }

  private issue(userId: number) {
    return { token: this.jwt.sign({ sub: String(userId) }), userId };
  }
}
