import { migrate } from '../src/migrate.js';
import { connect, MIGRATOR_URL } from './env.js';

// Fresh schema for every test run. Only ever points at the test database.
export default async function setup() {
  if (!/\/rppc_test(\?|$)/.test(MIGRATOR_URL)) throw new Error('Tests must run against the rppc_test database');
  const c = await connect(MIGRATOR_URL);
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
  await c.end();
  await migrate(MIGRATOR_URL);
}
