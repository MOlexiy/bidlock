import 'dotenv/config';
import { Db } from '../src/db/db';
import { migrate } from '../src/db/migrator';
import { DomainError } from '../src/common/errors';

export const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://bidlock:bidlock@localhost:5432/bidlock_test';

export async function freshDb(poolSize = 20) {
  const db = new Db(TEST_DB_URL, poolSize);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, () => undefined);
  return db;
}

export async function createUser(db: Db, username: string, balance: number) {
  const { id } = (await db.query('INSERT INTO users (username, balance) VALUES ($1, $2) RETURNING id', [username, balance])).rows[0];
  if (balance > 0) await db.query(`INSERT INTO ledger (user_id, kind, amount) VALUES ($1, 'deposit', $2)`, [id, balance]);
  return id as number;
}

export async function createAuction(
  db: Db,
  { startPrice = 100, minStep = 10, endsInSec = 600, antiSnipeSec = 0 } = {},
) {
  const r = await db.query(
    `INSERT INTO auctions (title, start_price, min_step, ends_at, anti_snipe_sec)
     VALUES ('test lot', $1, $2, now() + make_interval(secs => $3), $4) RETURNING id`,
    [startPrice, minStep, endsInSec, antiSnipeSec],
  );
  return r.rows[0].id as number;
}

export const wallet = async (db: Db, id: number) =>
  (await db.one<{ balance: number; frozen: number }>('SELECT balance, frozen FROM users WHERE id = $1', [id]))!;

/** Runs a promise and returns either its value or the DomainError code. Any other error is re-thrown. */
export async function outcome<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, code: e.code };
    throw e;
  }
}

/**
 * The money invariants. If any of these fails, someone got free money or lost it.
 */
export async function assertInvariants(db: Db) {
  const problems: string[] = [];

  // 1. Conservation: money only enters via deposits and leaves via charges.
  const c = (
    await db.query(`
      SELECT (SELECT COALESCE(SUM(balance + frozen), 0) FROM users) AS held,
             (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE kind = 'deposit') AS deposited,
             (SELECT COALESCE(SUM(amount), 0) FROM ledger WHERE kind = 'charge') AS charged`)
  ).rows[0];
  if (Number(c.held) !== Number(c.deposited) - Number(c.charged)) {
    problems.push(`conservation: held=${c.held} deposited=${c.deposited} charged=${c.charged}`);
  }

  // 2. A user's frozen funds are exactly the prices of the active auctions they lead.
  const f = await db.query(`
    SELECT u.id, u.frozen, COALESCE(SUM(a.current_price), 0) AS leading
      FROM users u
      LEFT JOIN auctions a ON a.leader_id = u.id AND a.status = 'active'
     GROUP BY u.id
    HAVING u.frozen <> COALESCE(SUM(a.current_price), 0)`);
  for (const r of f.rows) problems.push(`user ${r.id}: frozen=${r.frozen} but leads ${r.leading}`);

  // 3. Auction state matches its bid history; bids are strictly increasing (=> fully serialised).
  const a = await db.query(`
    WITH ordered AS (
      SELECT auction_id, amount, user_id,
             LAG(amount) OVER (PARTITION BY auction_id ORDER BY id) AS prev,
             ROW_NUMBER() OVER (PARTITION BY auction_id ORDER BY id DESC) AS rn
        FROM bids)
    SELECT a.id, a.current_price, a.leader_id, a.bids_count,
           (SELECT COUNT(*) FROM bids b WHERE b.auction_id = a.id) AS n,
           (SELECT amount FROM ordered o WHERE o.auction_id = a.id AND rn = 1) AS last_amount,
           (SELECT user_id FROM ordered o WHERE o.auction_id = a.id AND rn = 1) AS last_user,
           (SELECT COUNT(*) FROM ordered o WHERE o.auction_id = a.id AND prev IS NOT NULL AND amount <= prev) AS non_increasing
      FROM auctions a`);
  for (const r of a.rows) {
    if (Number(r.n) !== r.bids_count) problems.push(`auction ${r.id}: bids_count=${r.bids_count}, rows=${r.n}`);
    if ((r.last_amount ?? null) !== r.current_price) problems.push(`auction ${r.id}: price ${r.current_price} != last bid ${r.last_amount}`);
    if ((r.last_user ?? null) !== r.leader_id) problems.push(`auction ${r.id}: leader ${r.leader_id} != last bidder ${r.last_user}`);
    if (Number(r.non_increasing) > 0) problems.push(`auction ${r.id}: ${r.non_increasing} non-increasing bids`);
  }

  if (problems.length) throw new Error('Invariants violated:\n' + problems.join('\n'));
}
