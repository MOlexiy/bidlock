import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// BIGINT -> number. Amounts are coins and stay far below 2^53.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

export type Executor = Pick<PoolClient, 'query'>;

export class Db {
  readonly pool: Pool;

  constructor(connectionString: string, max = 20) {
    this.pool = new Pool({ connectionString, max });
  }

  async query<T extends QueryResultRow = any>(text: string, params: unknown[] = []) {
    return this.pool.query<T>(text, params);
  }

  async one<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.pool.query<T>(text, params)).rows[0];
  }

  /** Runs fn in a READ COMMITTED transaction. Row locks inside fn are what guarantee correctness. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
