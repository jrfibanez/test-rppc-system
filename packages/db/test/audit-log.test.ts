// Spec §7.1 audit_log hash chain + forbid_mutation; §19.4 "audit chain verification returns no broken row,
// including when the verifier runs under a different session time zone".
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, MIGRATOR_URL, connect, inRollback, sqlError } from './env.js';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => { app = await connect(APP_URL); owner = await connect(MIGRATOR_URL); });
afterAll(async () => { await app.end(); await owner.end(); });

const insertAudit = (c: pg.ClientBase, action: string, after: unknown = { n: 1 }) =>
  c.query(`INSERT INTO audit_log (actor_id, action, entity_type, entity_id, after)
           VALUES (gen_random_uuid(), $1, 'test', gen_random_uuid(), $2) RETURNING id`, [action, JSON.stringify(after)]);

const broken = async (c: pg.ClientBase) =>
  (await c.query<{ broken_at: string }>('SELECT broken_at FROM fn_verify_audit_chain()')).rows;

describe('audit_log hash chain', () => {
  it('links each row to the previous one and verifies clean', async () => {
    for (let i = 0; i < 5; i++) await insertAudit(app, `test.seq${i}`);
    await insertAudit(app, 'test.nulls', null);
    const { rows } = await app.query<{ prev_hash: Buffer; hash: Buffer }>(
      'SELECT prev_hash, hash FROM audit_log ORDER BY id');
    expect(rows[0]!.prev_hash.equals(Buffer.from([0]))).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash.equals(rows[i - 1]!.hash)).toBe(true);
    expect(await broken(app)).toEqual([]);
  });

  it('verifies clean under other session time zones', async () => {
    for (const tz of ['Asia/Manila', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      await app.query(`SET TIME ZONE '${tz}'`);
      expect(await broken(app)).toEqual([]);
      await insertAudit(app, `test.tz.${tz}`);       // rows written under any zone verify under any other
    }
    await app.query("SET TIME ZONE 'UTC'");
    expect(await broken(app)).toEqual([]);
  });

  it('stays intact under concurrent writers', async () => {
    const pool = new pg.Pool({ connectionString: APP_URL, max: 20 });
    try {
      await Promise.all(Array.from({ length: 60 }, async (_, i) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          await c.query(`SELECT pg_sleep(${(Math.random() * 0.02).toFixed(3)})`);
          await insertAudit(c, `test.par${i}`);
          await c.query(`SELECT pg_sleep(${(Math.random() * 0.02).toFixed(3)})`);
          await c.query(i % 7 === 0 ? 'ROLLBACK' : 'COMMIT');
        } finally { c.release(); }
      }));
    } finally { await pool.end(); }
    expect(await broken(app)).toEqual([]);
  });

  it('stays intact when a transaction writes two rows around a waiting writer', async () => {
    // B writes a row (holds the chain lock), A starts an insert (takes the next id, then waits for the lock),
    // B writes a second row (a higher id than A's) and commits. Verification walks rows by id.
    const a = await connect(APP_URL);
    const b = await connect(APP_URL);
    try {
      await b.query('BEGIN');
      await insertAudit(b, 'test.b1');
      await a.query('BEGIN');
      const aInsert = insertAudit(a, 'test.a1');
      await new Promise((r) => setTimeout(r, 200));          // A now waits on the chain lock
      await insertAudit(b, 'test.b2');
      await b.query('COMMIT');
      await aInsert;
      await a.query('COMMIT');
    } finally { await a.end(); await b.end(); }
    expect(await broken(app)).toEqual([]);
  });

  it('detects a tampered row', async () => {
    await inRollback(owner, async () => {
      const { rows: [r] } = await owner.query<{ id: string }>('SELECT id FROM audit_log ORDER BY id OFFSET 2 LIMIT 1');
      await owner.query('ALTER TABLE audit_log DISABLE TRIGGER audit_immutable');
      await owner.query(`UPDATE audit_log SET after = '{"n":999}' WHERE id = $1`, [r!.id]);
      expect(await broken(owner)).toEqual([{ broken_at: r!.id }]);
    });
    expect(await broken(app)).toEqual([]);
  });

  it('detects a deleted row', async () => {
    await inRollback(owner, async () => {
      const { rows: [r] } = await owner.query<{ id: string }>('SELECT id FROM audit_log ORDER BY id OFFSET 1 LIMIT 1');
      await owner.query('ALTER TABLE audit_log DISABLE TRIGGER audit_immutable');
      await owner.query('DELETE FROM audit_log WHERE id = $1', [r!.id]);
      const rows = await broken(owner);
      expect(rows).toHaveLength(1);
      expect(BigInt(rows[0]!.broken_at)).toBeGreaterThan(BigInt(r!.id));
    });
  });

  it('ignores a client-supplied prev_hash and hash', async () => {
    await app.query(`INSERT INTO audit_log (action, prev_hash, hash) VALUES ('test.forged', '\\x01', '\\x02')`);
    expect(await broken(app)).toEqual([]);
  });
});

describe('forbid_mutation (append-only audit_log)', () => {
  it('the trigger refuses UPDATE and DELETE, even for the table owner', async () => {
    await inRollback(owner, async () => {
      expect(await sqlError(owner, "UPDATE audit_log SET action = 'x'")).toMatch(/UPDATE on audit_log is not allowed \(append-only\)/);
      expect(await sqlError(owner, 'DELETE FROM audit_log')).toMatch(/DELETE on audit_log is not allowed \(append-only\)/);
    });
  });

  it('app_user has no UPDATE, DELETE or TRUNCATE privilege on audit_log', async () => {
    await inRollback(app, async () => {
      expect(await sqlError(app, "UPDATE audit_log SET action = 'x'")).toMatch(/permission denied/);
      expect(await sqlError(app, 'DELETE FROM audit_log')).toMatch(/permission denied/);
      expect(await sqlError(app, 'TRUNCATE audit_log')).toMatch(/permission denied/);
    });
  });

  it('works as a generic trigger on any table', async () => {
    await inRollback(owner, async () => {
      await owner.query('CREATE TEMP TABLE t_append (x int)');
      await owner.query('CREATE TRIGGER t_imm BEFORE UPDATE OR DELETE ON t_append FOR EACH ROW EXECUTE FUNCTION forbid_mutation()');
      await owner.query('INSERT INTO t_append VALUES (1)');
      expect(await sqlError(owner, 'UPDATE t_append SET x = 2')).toMatch(/UPDATE on t_append is not allowed/);
      expect(await sqlError(owner, 'DELETE FROM t_append')).toMatch(/DELETE on t_append is not allowed/);
    });
  });
});
