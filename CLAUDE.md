@AGENTS.md

# Waypoint — shared rules (all members)

Team CodeRunners. One Next.js 16 App Router app (strict TypeScript) serving four portals:
dispatcher (Member 1), loader (Member 2), driver + shared offline (Member 3), store (Member 4).
Read `docs/TEAM_CONTRACT.md`, `docs/CONTRACT_V1.md` (how v1 was implemented; wins over the contract text)
and `docs/SETUP_AND_HANDOFF.md` before editing, then your portal's `src/app/<portal>/CLAUDE.md`.

## Ownership
- Your portal: `src/app/<portal>/**`, `src/app/api/<portal>/**`, `src/features/<portal>/**`, tests for them.
- Lead-owned shared files (change only through the lead, report blockers instead):
  `prisma/**`, `src/shared/**`, `src/server/**`, `src/auth.ts`, `src/components/shell/**`,
  `src/components/providers.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, Docker files, `package.json`.
- `src/components/ui/**` is shadcn output. Add new shadcn components via the lead, do not hand-edit existing ones.

## Server rules (every API route)
- Wrap handlers with `handle()` from `@/server/http`; return `ok(data)`; throw `HttpError` helpers.
- Auth: `requireRole(...)` from `@/server/auth/guards`, then an object-level scope check
  (`assertOutletScope` / `assertDriverScope` / `assertDepotScope`) on every record you load. Role alone is not enough.
- Mutations: call `assertSameOrigin(req)`, parse with `parseJson(req, zodSchema)`, write through
  `runMutation()` from `@/server/mutation` (one serializable transaction, audit row, idempotency key,
  `assertVersion` for optimistic concurrency). Offline-replayed mutations pass `requireIdempotencyKey: true`.
- Time: never `new Date()` for business logic. Use `now()`, `localDate()`, `zonedInstant()`,
  `isBeforeCutoff()` from `@/server/time` (APP_TIMEZONE=Asia/Colombo, optional DEMO_CLOCK).
- Numbers: Prisma Decimal stays server-side; convert with `@/server/decimal` at the DTO boundary.
- Photos/evidence: `saveUpload` / `readUpload` from `@/server/storage`; serve only through a scope-checked route.
- Unbuilt endpoints return `notImplemented("...")` (501). Never fake a successful mutation.
- Errors: `validationError` / `constraintError` (422), `versionConflict` / `revisionConflict` /
  `invalidTransition` (409). Version and revision checks: `assertVersion`, `assertRevision` from `@/server/mutation`.
- Calendar/cutoff: `loadCalendar()` + `earliestEligibleDate()` from `@/server/calendar`. Never hardcode Mon-Sat.
- DTOs: build responses with the shared mappers in `@/server/dto` (`toOrderDto`, `toManifestDto`, ...).

## Client rules
- Fetch with `apiFetch` from `@/shared/api` inside TanStack Query hooks; poll with `refetchInterval` (no sockets).
- Forms: react-hook-form + zod resolver. Share zod schemas/DTO types from `src/shared/dto/*`
  (`order.ts`, `plan.ts`, `manifest.ts`, `issue.ts`, `files.ts`, `reference.ts`, `enums.ts`).
- Master data: `GET /api/shared/reference` (role-scoped outlets, vehicles, calendar, cutoff).
  Show outlets with `outletLabel()`; no outlet names are supplied.
- UI: shadcn components + design tokens in `globals.css` (`bg-lime`, `text-late`, `bg-warn-soft`,
  `text-chilled`/`fresh`/`ambient`, `font-id` for IDs like VEH014 / OUT045 / clock times).
  Designs live in `docs/design/<portal>/`. All screens must work at phone width.
- Toasts: `toast` from `sonner`.

## Commands
`npm run dev | build | lint | typecheck | test | test:integration | test:e2e | db:migrate | db:seed`
Local DB: `docker compose up -d db` then `npm run db:deploy && npm run db:seed`.
Full stack: `docker compose up --build` (http://localhost:3000).
Demo logins: `dispatcher`, `loader`, `driver`, `store`, password from DEMO_PASSWORD (default `Waypoint#2026`).

## Git
Branch from `setup-v1` per member (`feat/<portal>-...`). Small PRs into `main`. Schema/DTO changes land via the lead first.
Never run multiple Claude sessions in the same checkout; use separate clones or `git worktree`.
