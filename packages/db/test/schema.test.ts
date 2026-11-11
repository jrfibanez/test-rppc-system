// Spec §7.10 ownership and grants, §7.11 updated_at triggers, CLAUDE.md rule 2 (never edit an applied migration).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.js';
import { APP_URL, MIGRATOR_URL, connect, inRollback, sqlError } from './env.js';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => { app = await connect(APP_URL); owner = await connect(MIGRATOR_URL); });
afterAll(async () => { await app.end(); await owner.end(); });

describe('ownership and grants (§7.10)', () => {
  it('no table is owned by app_user or app_client', async () => {
    const { rows } = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner IN ('app_user','app_client')`);
    expect(rows).toEqual([]);
  });

  it('app_user cannot run DDL', async () => {
    await inRollback(app, async () => {
      expect(await sqlError(app, 'CREATE TABLE x (id int)')).toMatch(/permission denied/);
      expect(await sqlError(app, 'ALTER TABLE clients ADD COLUMN x int')).toMatch(/must be owner/);
      expect(await sqlError(app, 'DROP TABLE clients')).toMatch(/must be owner/);
    });
  });

  it('app_user can read and write masters but not delete or truncate them', async () => {
    await inRollback(app, async () => {
      await app.query(`INSERT INTO clients (code, legal_name) VALUES ('T1', 'Test Client')`);
      await app.query(`UPDATE clients SET trade_name = 'T' WHERE code = 'T1'`);
      expect(await sqlError(app, `DELETE FROM clients WHERE code = 'T1'`)).toMatch(/permission denied/);
      expect(await sqlError(app, 'TRUNCATE clients')).toMatch(/permission denied/);
    });
  });

  it('app_user may delete only housekeeping rows (sessions, recovery codes)', async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'app_user' AND privilege_type = 'DELETE' ORDER BY table_name`);
    expect(rows.map((r) => r.table_name)).toEqual(['mfa_recovery_codes', 'sessions']);
  });

  it('app_user cannot see migration bookkeeping', async () => {
    await inRollback(app, async () => {
      expect(await sqlError(app, 'SELECT * FROM schema_migrations')).toMatch(/permission denied/);
    });
  });

  it('app_user can switch to app_client (portal requests)', async () => {
    await inRollback(app, async () => {
      await app.query('SET LOCAL ROLE app_client');
      const { rows: [r] } = await app.query<{ u: string }>('SELECT current_user AS u');
      expect(r!.u).toBe('app_client');
    });
  });
});

describe('updated_at triggers (§7.11)', () => {
  it('every table with updated_at has the set_updated_at trigger', async () => {
    const { rows } = await owner.query<{ table_name: string; has: boolean }>(`
      SELECT c.table_name,
             EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', c.table_name)::regclass
                      AND tgname = 'set_updated_at') AS has
        FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => !r.has)).toEqual([]);
  });

  it('bumps updated_at on update', async () => {
    await inRollback(app, async () => {
      await app.query(`INSERT INTO clients (code, legal_name, updated_at) VALUES ('T2', 'X', '2000-01-01')`);
      await app.query(`UPDATE clients SET legal_name = 'Y' WHERE code = 'T2'`);
      const { rows: [r] } = await app.query<{ y: number }>(
        `SELECT EXTRACT(YEAR FROM updated_at)::int AS y FROM clients WHERE code = 'T2'`);
      expect(r!.y).toBeGreaterThan(2000);
    });
  });
});

describe('migration runner', () => {
  it('is a no-op when re-run', async () => {
    expect((await migrate(MIGRATOR_URL)).applied).toEqual([]);
  });

  it('refuses an edited applied migration', async () => {
    const { rows: [r] } = await owner.query<{ checksum: string }>(
      `SELECT checksum FROM schema_migrations WHERE version = '0001_foundation.sql'`);
    await owner.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_foundation.sql'`);
    try {
      await expect(migrate(MIGRATOR_URL)).rejects.toThrow(/was edited/);
    } finally {
      await owner.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = '0001_foundation.sql'`, [r!.checksum]);
    }
  });

  it('refuses to run as app_user', async () => {
    await expect(migrate(APP_URL)).rejects.toThrow(/Refusing to migrate as app_user/);
  });
});

describe('add_business_days (BR-08 helper)', () => {
  it('skips weekends and holidays', async () => {
    await inRollback(app, async () => {
      await app.query(`INSERT INTO holidays (hdate, name) VALUES ('2026-12-30', 'Rizal Day')`);
      // Mon 2026-12-28 + 5 business days, skipping Wed 30 (holiday), Sat/Sun 2–3 Jan -> Tue 2027-01-05
      const { rows: [r] } = await app.query<{ d: string }>(`SELECT add_business_days('2026-12-28', 5)::text AS d`);
      expect(r!.d).toBe('2027-01-05');
    });
  });
});
