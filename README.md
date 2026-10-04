# Waypoint — CodeRunners

Distribution operations app with four role portals: **dispatcher**, **loader**, **driver** (offline-capable) and **store manager**.

> Status: foundation (`setup-v1`). Portals are scaffolded and authenticated; business flows are being built per member.

## Quick start (Docker)

```bash
docker compose up --build
```

Starts PostgreSQL 17, applies committed migrations, runs the idempotent seed, then serves the app on http://localhost:3000.
Compose defaults are for local demo only — see [Production configuration](#production-configuration).

| Role | Username | Password |
|---|---|---|
| Dispatcher | `dispatcher` | `Waypoint#2026` |
| Loader | `loader` | `Waypoint#2026` |
| Driver | `driver` | `Waypoint#2026` |
| Store manager | `store` | `Waypoint#2026` |

Scopes, extra accounts (Kandy, one driver per vehicle) and the seeded demo scenario: [docs/CONTRACT_V1.md](docs/CONTRACT_V1.md#seeded-data).

## Local development

Requires Node 24+ and Docker.

```bash
npm ci
cp .env.example .env          # set AUTH_SECRET
docker compose up -d db
npm run db:deploy && npm run db:seed
npm run dev
```

If host port 5432 is taken, set `DB_HOST_PORT=5434` in `.env` and point `DATABASE_URL` at that port.

| Script | Purpose |
|---|---|
| `npm run lint` / `typecheck` / `build` | Static checks and production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | DB-backed tests against `DATABASE_URL` |
| `npm run test:e2e` | Playwright (desktop + phone) against `E2E_BASE_URL` |
| `npm run db:migrate` | Create a new migration (lead only) |
| `npm run db:deploy` / `db:seed` | Apply migrations / idempotent seed |

## Production configuration

Set real values for `AUTH_SECRET`, `AUTH_URL`, database credentials and either a strong `DEMO_PASSWORD` or `DEMO_SEED=false`. Leave `DEMO_CLOCK` empty. Re-running the seed never resets existing accounts or completed deliveries.

## Project layout

```
prisma/                 schema, migrations, seed (lead-owned)
src/app/<portal>/       portal pages (dispatcher | loader | driver | store)
src/app/api/<portal>/   portal route handlers
src/features/<portal>/  portal components, hooks, services
src/server/             db, http helpers, auth guards, mutation/idempotency, time, storage
src/shared/             DTOs, API envelope, roles (client-safe)
docs/                   TEAM_CONTRACT (meaning), CONTRACT_V1 (implementation + deviations), setup guide, designs
data/general/           organizer CSV master data
```

## Judge walkthrough

_To be completed with concrete IDs once flows land (see `docs/SETUP_AND_HANDOFF.md`)._
