import { config } from '../config';
import { Db } from './db';
import { migrate } from './migrator';

const USERS = ['alice', 'bob', 'carol', 'dave'];
const AUCTIONS = [
  { title: 'Golden Star #12', emoji: '⭐', startPrice: 100, minStep: 10, durationSec: 10 * 60 },
  { title: 'Lucky Cat #7', emoji: '🐱', startPrice: 250, minStep: 25, durationSec: 30 * 60 },
  { title: 'Neon Rocket #3', emoji: '🚀', startPrice: 500, minStep: 50, durationSec: 2 * 3600 },
  { title: 'Flash Gem #1', emoji: '💎', startPrice: 50, minStep: 5, durationSec: 90, antiSnipeSec: 15 },
];

/** Inserts demo data. Settlement jobs are created by the sweeper once the API is running. */
(async () => {
  const db = new Db(config.databaseUrl, 1);
  try {
    await migrate(db);
    for (const u of USERS) {
      const r = await db.query(
        `INSERT INTO users (username, balance) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING RETURNING id`,
        [u, config.startingBalance],
      );
      if (r.rows[0]) {
        await db.query(`INSERT INTO ledger (user_id, kind, amount) VALUES ($1, 'deposit', $2)`, [r.rows[0].id, config.startingBalance]);
      }
    }
    for (const a of AUCTIONS) {
      await db.query(
        `INSERT INTO auctions (title, emoji, start_price, min_step, ends_at, anti_snipe_sec)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6)`,
        [a.title, a.emoji, a.startPrice, a.minStep, a.durationSec, a.antiSnipeSec ?? 30],
      );
    }
    console.log(`seeded ${USERS.length} users (${USERS.join(', ')}) and ${AUCTIONS.length} auctions`);
  } finally {
    await db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
