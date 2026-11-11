# RPPC Operations System

Source of truth: docs/SPEC.md. Do not invent business rules. If a rule is missing or unclear, stop and ask.

## Stack
TypeScript, Next.js (App Router), PostgreSQL 16, pg-boss jobs, S3-compatible private storage, PWA for field users.

## Rules
1. Every API route is wrapped in route(permission, handler). No route without a permission. Permissions are checked on the server.
2. Migrations are numbered SQL files in packages/db/migrations. Never edit an applied migration; add a new one.
3. Issued documents (SO, DR, gate pass, billing summary, return receipt) are never edited or deleted: void with a reason.
   pallet_movements and audit_log are append-only; corrections are reversal entries.
4. Money is numeric(14,2). No floating point for money. Store UTC, display Asia/Manila.
5. Every state change writes an audit_log row in the same transaction.
6. Segregation of duties (spec 8.3): approver is never the creator or the payee. The Owner approves every voucher.
7. Write the test first for each business rule. Name tests after the rule id (BR-06 etc.).
8. Never log passwords, PINs, tokens, TOTP secrets or photos.
9. Field screens (driver, helper, guard, worker) are mobile-first, big buttons, and work offline with idempotent sync.
10. Exports (billing, payroll) are permission-gated and audited.
11. Settings live in the settings table (spec 7.1), never in constants. Grants and ownership follow spec 7.10 (migrations run as a separate owner role). Add new tables only with their grants, `updated_at` where mutable, and rerun the 7.11 trigger step.
12. Notes to remember: trips.status 'returned' means the truck is back at the plant; crew pay by trip type is in BR-29; completed_at semantics are in spec 10.5.
13. Permissions come from one catalog (spec 10.2). PIN sessions can never use a sensitive permission. Quantities on trips live in trip_lines; every in_transit movement carries a trip_id.

## Definition of done for a slice
Migration + API + UI + tests (rules, permissions matrix, IDOR) + audit rows + short note in docs/CHANGELOG.md.

## Local setup notes
- Database roles: `rppc_migrator` owns every object and runs migrations; the app connects as `app_user`; `app_client` is the portal role (spec 7.10). They are created by ops/db/init.sql.
- `pnpm db:migrate` applies packages/db/migrations in order, then the post steps in packages/db/post (spec 7.11 trigger step and the generic grants). Applied migrations are checksummed; editing one fails the run.
- `pnpm test` runs DB tests against DATABASE_URL_MIGRATOR / DATABASE_URL_APP (see .env.example).
