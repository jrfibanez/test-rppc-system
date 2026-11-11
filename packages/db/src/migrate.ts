// Applies numbered SQL migrations, then the post steps (spec §7.10 grants, §7.11 updated_at triggers).
// Must run as the owner role (rppc_migrator), never as app_user (spec §7.10 "Ownership").
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'migrations');
const POST_DIR = join(root, 'post');
const FILE_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrateResult { applied: string[] }

function sqlFiles(dir: string, strict: boolean): string[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (strict) {
    files.forEach((f, i) => {
      const m = FILE_RE.exec(f);
      if (!m) throw new Error(`Bad migration file name: ${f} (expected NNNN_name.sql)`);
      if (Number(m[1]) !== i + 1) throw new Error(`Migration numbering gap or duplicate at ${f}`);
    });
  }
  return files;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function migrate(connectionString: string, log: (m: string) => void = () => {}): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows: [who] } = await client.query<{ u: string }>('SELECT current_user AS u');
    if (who?.u === 'app_user' || who?.u === 'app_client') {
      throw new Error(`Refusing to migrate as ${who.u}: migrations run as the owner role (spec §7.10)`);
    }
    await client.query('SELECT pg_advisory_lock(727000)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.version, r.checksum]));

    const applied: string[] = [];
    for (const file of sqlFiles(MIGRATIONS_DIR, true)) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const sum = sha256(sql);
      const prev = done.get(file);
      if (prev !== undefined) {
        if (prev !== sum) throw new Error(`Applied migration ${file} was edited. Never edit an applied migration; add a new one.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }

    for (const file of sqlFiles(POST_DIR, false)) {
      await client.query(readFileSync(join(POST_DIR, file), 'utf8'));
    }
    // schema_migrations is bookkeeping for the owner only.
    await client.query('REVOKE ALL ON schema_migrations FROM app_user, app_client');

    const { rows: owned } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner IN ('app_user','app_client')`);
    if (owned.length) throw new Error(`Tables owned by app roles (RLS would be bypassed): ${owned.map((r) => r.tablename).join(', ')}`);
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock(727000)').catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) { console.error('DATABASE_URL_MIGRATOR is not set'); process.exit(1); }
  migrate(url, console.log).then(
    (r) => console.log(r.applied.length ? `done (${r.applied.length} applied)` : 'up to date'),
    (e: Error) => { console.error(e.message); process.exit(1); },
  );
}
