# RPPC Operations System

Spec: [docs/SPEC.md](docs/SPEC.md) · Rules for contributors and Claude Code: [CLAUDE.md](CLAUDE.md) · Progress: [docs/CHANGELOG.md](docs/CHANGELOG.md)

## Run locally

Needs Node 22, pnpm 10 and Docker.

```bash
docker compose -f ops/docker-compose.yml up -d
pnpm install
cp .env.example .env   # then export the variables, or use your own tooling
pnpm db:migrate
pnpm test
```

The tests drop and recreate the `public` schema of the `rppc_test` database only.
