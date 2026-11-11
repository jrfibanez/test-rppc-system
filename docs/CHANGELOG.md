# Changelog

## S0.1 + S0.2 — repo, CI, database foundation (2026-11-11)

- Monorepo skeleton from spec §9 (pnpm workspaces): `apps/web`, `packages/db`, `packages/core`, `packages/pdf`, `ops/`.
  Only `packages/db` has code; the others are placeholders. No UI or API yet.
- `ops/docker-compose.yml` (Postgres 16) and `ops/db/init.sql`: roles `rppc_migrator` (owner), `app_user`, `app_client` (§7.10).
- Migration runner (`pnpm db:migrate`): numbered files, checksums (an edited applied migration fails), refuses to run as
  `app_user`, then runs the §7.11 trigger step and the §7.10 grants, and checks that no table is owned by an app role.
- Migrations: `0001_foundation.sql` (§7.1 verbatim), `0002_masters.sql` (§7.2 verbatim),
  `0003_audit_chain_order.sql` (fix, below).
- DB tests (26): `next_doc_no` (100 parallel inserts, no gaps; rollbacks consume no number; Manila year format),
  `forbid_mutation`, audit hash chain (clean, other time zones, concurrency, tamper and delete detection, forged hashes),
  ownership/grants, `updated_at` triggers, runner behaviour, `add_business_days`.

### Spec deviation: audit chain trigger (0003)
The §7.1 trigger chains rows in lock order, but `id` is taken from the sequence before the lock, so a transaction that
writes two audit rows around a waiting writer leaves rows out of id order. `fn_verify_audit_chain()` then reports a
broken row with no tampering (reproduced deterministically in `audit-log.test.ts`). 0003 assigns the id after the lock.
The spec text in §7.1 should be updated to match.

### Not done yet
- §10.1 seed (roles, permissions, settings): comes with S0.4. Until then `v_client_current_cutoff` returns NULL for
  clients without a cutoff row, because `billing.default_cutoff_day` is not seeded.
- Docker was not available where this was built; tests ran on a local PostgreSQL 16.15. The compose file is untested.
