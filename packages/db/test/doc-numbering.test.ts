// Spec §7.1 next_doc_no, §15 "doc-number gap-free under concurrency (100 parallel inserts)".
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_URL, connect } from './env.js';

const pool = new pg.Pool({ connectionString: APP_URL, max: 25 });
afterAll(() => pool.end());

async function issue(type: string, prefix: string, commit: boolean): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [r] } = await c.query<{ no: string }>('SELECT next_doc_no($1, $2) AS no', [type, prefix]);
    await c.query(`SELECT pg_sleep(${(Math.random() * 0.02).toFixed(3)})`);   // hold the row lock a little
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return r!.no;
  } finally {
    c.release();
  }
}

const manilaYear = () =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));

describe('next_doc_no', () => {
  it('formats PREFIX-YYYY-NNNNNN using the Manila year', async () => {
    const c = await connect(APP_URL);
    const { rows: [r] } = await c.query<{ no: string }>("SELECT next_doc_no('fmt', 'DR') AS no");
    await c.end();
    expect(r!.no).toBe(`DR-${manilaYear()}-000001`);
  });

  it('100 parallel inserts give 1..100 with no gaps and no duplicates', async () => {
    const nos = await Promise.all(Array.from({ length: 100 }, () => issue('par', 'SO', true)));
    const n = nos.map((s) => Number(s.split('-')[2])).sort((a, b) => a - b);
    expect(n).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('a rolled-back transaction does not consume a number, even when mixed with concurrent commits', async () => {
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => issue('mix', 'GP', i % 3 !== 0).then((no) => ({ no, committed: i % 3 !== 0 }))),
    );
    const committed = results.filter((r) => r.committed).length;
    const c = await connect(APP_URL);
    const { rows: [s] } = await c.query<{ last_value: string }>(
      "SELECT last_value FROM doc_sequences WHERE doc_type = 'mix'");
    await c.end();
    expect(Number(s!.last_value)).toBe(committed);   // the counter equals the committed documents: no gaps
  });

  it('keeps separate counters per document type', async () => {
    const c = await connect(APP_URL);
    const { rows } = await c.query<{ a: string; b: string }>(
      "SELECT next_doc_no('typeA','A') AS a, next_doc_no('typeB','B') AS b");
    await c.end();
    expect(rows[0]!.a.endsWith('-000001')).toBe(true);
    expect(rows[0]!.b.endsWith('-000001')).toBe(true);
  });
});
