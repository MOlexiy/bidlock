import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from './db';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/** Minimal forward-only migrator: plain SQL files, applied once, in name order. */
export async function migrate(db: Db, log = console.log) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`applied ${file}`);
  }
}
