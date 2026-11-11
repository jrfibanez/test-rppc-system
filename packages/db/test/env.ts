import pg from 'pg';

export const MIGRATOR_URL =
  process.env.TEST_DATABASE_URL_MIGRATOR ?? 'postgres://rppc_migrator:rppc_migrator@localhost:5432/rppc_test';
export const APP_URL =
  process.env.TEST_DATABASE_URL_APP ?? 'postgres://app_user:app_user@localhost:5432/rppc_test';

export async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Runs fn in a transaction that is always rolled back. */
export async function inRollback<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try { return await fn(); } finally { await c.query('ROLLBACK'); }
}

/** Expects the query to fail; returns the Postgres error message. */
export async function sqlError(c: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query('SAVEPOINT expect_error');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT expect_error');
    return (e as Error).message;
  }
  throw new Error(`expected an error from: ${sql}`);
}
