# Contract v1: how it was implemented (frozen at `setup-v1`)

`docs/TEAM_CONTRACT.md` defines what things mean. This file records how the lead turned it into code, and every place where the code differs from the contract text. If the two disagree, the code and this file win. Changes after `setup-v1` go through the lead and get listed in the changelog at the bottom.

## Where things live

| What | Where |
|---|---|
| Prisma schema (all domain models) | `prisma/schema.prisma`, migrations `prisma/migrations/` |
| Client-safe enums | `src/shared/dto/enums.ts` (a unit test fails if they drift from Prisma) |
| DTO types + zod input schemas | `src/shared/dto/{common,reference,order,plan,manifest,issue,files,me}.ts` |
| Prisma row to DTO mappers | `src/server/dto.ts` (`toOrderDto`, `toManifestDto`, `toTripSummaryDto`, `toIssueDto`, `toAttachmentDto` plus matching `*Include`) |
| Calendar, cutoff, ISO week | `src/server/calendar.ts` |
| CSV import and validation | `prisma/lib/masters.ts` (unit-tested against the real CSVs) |
| Endpoint stubs (501 until built) | `src/app/api/<portal>/**/route.ts`, one per contract path |

The contract says response types go in `src/lib/contracts`. This repo puts them in `src/shared/dto`, as root `CLAUDE.md` already says.

## Deviations from TEAM_CONTRACT text

1. **Response envelope.** Success is `{ ok: true, data }` and errors are `{ ok: false, error: { code, message, details? } }`, matching the existing `apiFetch`. Contract fields map into `details`: `currentVersion`, `currentRevision` and `fieldErrors`. Codes: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `VERSION_CONFLICT` / `REVISION_CONFLICT` / `INVALID_TRANSITION` / `CONFLICT`, 422 `VALIDATION` / `CONSTRAINT`, 503 `UNAVAILABLE`, 501 `NOT_IMPLEMENTED`. Helpers are in `@/server/http`.
2. **Login is `username`, not email.** Roles are `DISPATCHER | LOADER | DRIVER | STORE` (`STORE` = store manager).
3. **One `Plan` per depot and service date** (`@@unique([depotId, serviceDate])`). `Plan.revision` starts at 0 and becomes 1 on first publish. Editing a published plan republishes as revision n+1 on the same row, and trips that changed get the new `Trip.planRevision`. Loaders and drivers compare `planRevision` (409 `REVISION_CONFLICT`).
4. **Driver scope.** `User.vehicleId` links a driver account to its vehicle. Trip access is always `Trip.assignedDriverId === session user id` (`assertDriverScope(user, trip.assignedDriverId)`). The seed creates one driver account per vehicle so every trip can have a real driver.
5. **`assertDepotScope` is strict.** An account without a depot is denied. Every seeded account has one (store and driver accounts get their outlet's or vehicle's depot).
6. **Audit and idempotency tables** keep their existing names, `AuditLog` (now with `clientAt` and `planRevision`) and `IdempotencyKey`. The key is globally unique, and replay also checks actor, route and request hash.
7. **Upload limit is 5 MB** (contract), for jpeg, png and webp, with a magic-byte check.
8. **`/api/me`** still works as an alias of `/api/shared/me`.

## Lead decisions the contract left open

- **Calendar range.** The supplied `calendar.csv` covers 2024-01-01 to 2026-06-28 only. Dates after that use the contract's Monday-Saturday rule and are marked `source: "derived"` in `CalendarDayDto`. They are never stored as imported rows. All cutoff logic goes through `loadCalendar()` + `earliestEligibleDate()`.
- **Cutoff.** A run's queue closes at 16:00 Asia/Colombo on the operating day before that run. Exactly 16:00 counts as closed. Fri 15:59 goes to Sat, Fri 16:00 to Mon, Sat 15:59 to Mon, Sat 16:00 to Tue, and Sunday to Tue. Unit tests cover these cases plus a supplied holiday.
- **Outlet names.** None are supplied, so we never invent them. Use `outletLabel()`, which gives e.g. `OUT001 · Fresh Colombo`.
- **Temps per brand** (`BRAND_TEMPS`): Fresh can be AMBIENT or CHILLED, Style and Tech AMBIENT only. FROZEN is in the enum but no brand can order it in the MVP.
- **Issues.** `Issue.blocking = true` (loader SHORTFALL/DAMAGE) blocks READY and departure until it is RESOLVED.
- **Travel distances are not supplied.** The engine (Member 1) must use documented estimates and label them as estimates. The seeded history trips use stated estimate km.
- **Fuel.** `Vehicle.fuelLitersPerKm = 1 / km_per_l`, converted once at import. The ledger is `VehicleWeekFuel` (vehicle + ISO week) plus one `TripFuelReservation` per trip.
- **Attachments.** Upload is provisional (`linkedAt = null`). The business mutation links the file by setting `proofId`, `issueId` or `receiptId` plus `linkedAt`. Files that are still unlinked after 24 h are orphans.

## Seeded data

Master data is always imported. If a CSV is missing, malformed or has the wrong row counts, the seed aborts. With `DEMO_SEED=true` the seed also creates demo data, but only rows that are missing, so a rerun never resets anything.

Accounts (password `DEMO_PASSWORD`, default `Waypoint#2026`; in `.env` it must be quoted, because an unquoted `#` starts a comment):

| Username | Role | Scope |
|---|---|---|
| `dispatcher` | DISPATCHER | Peliyagoda |
| `loader` | LOADER | Peliyagoda |
| `driver` | DRIVER | VEH035 (refrigerated van, Peliyagoda) |
| `store` | STORE | OUT001 (Fresh, Colombo, van_only, 05:00-07:30) |
| `dispatcher-kandy`, `loader-kandy` | | Kandy (for wrong-depot checks) |
| `driver-veh001` ... `driver-veh060` | DRIVER | one per remaining vehicle |

Scenario (`DEMO_SERVICE_DATE`, default 2026-09-26, a Saturday):

- **Previous run, 2026-09-25: published plan, revision 1**
  - VEH035 trip 1 (driver `driver`), PLANNED: OUT001 `ORD-260925-H01` then OUT002 `H02`.
  - VEH036 trip 1 (driver `driver-veh036`), LOADING: OUT003 `H03`. A loader check is 7 milk crates short, and an OPEN blocking SHORTFALL issue is raised.
  - `H04` (OUT003, chilled, 540 kg) is DEFERRED with `CAPACITY_WEIGHT` and the exceeded amount stated. Next eligible date is 2026-09-26.
- **Demo day, 2026-09-26: CONFIRMED queue `ORD-260926-D01..D11` plus the carried `H04`**
  - Separate ambient and chilled orders for OUT001 (D01, D02) and for OUT004 (D06, D07).
  - van_only chilled orders (D02, D03, D04, plus H04) that cannot all fit the two 1040 kg refrigerated vans on first trips.
  - Volume-heavy Style at a mall dock (D10, OUT015, mall window 09:00-11:00).
  - Weight-heavy Tech (D11, 2840 kg).

## Changelog

- v1 (`setup-v1`): initial freeze.
