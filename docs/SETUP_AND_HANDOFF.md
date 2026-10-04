# Team lead setup, handoff and execution guide

## What this pack contains
Four member-specific CLAUDE.md files under portal directories, one root CLAUDE.md for shared rules, TEAM_CONTRACT for integration, and this guide. Copy the directory contents into the initialized repository, preserving paths. It contains instructions only: no app, database migrations or runnable Docker stack have been created or tested by this pack.

Recommended assignments: user/Member 1 = dispatcher plus initial foundation; Member 2 = loader; Member 3 = driver and shared offline; Member 4 = store. If a different person is strongest in business-rule testing, assign them dispatcher and put the user on another portal. Foundation remains a short shared setup task, not an extra full-time fifth role. Driver/offline and dispatcher are the heaviest workloads; loader/store members help with integration QA after their vertical slices work.

## Why this stack
| Layer | Choice | Why it fits this challenge |
|---|---|---|
| UI + API | Next.js, React, strict TypeScript | One language and one deployable app; four route sections and route handlers reduce backend/frontend handoff overhead |
| Database | PostgreSQL 17 | Relational ordering/trip/proof/receipt data and transactional constraints; portable Compose database |
| ORM | Prisma 7 + PostgreSQL adapter | Shared schema and typed queries/migrations; explicitly pinned major avoids switching APIs mid-project |
| Auth | Auth.js Credentials + bcryptjs | Four seeded logins without external OAuth setup; app owns password verification and row authorization |
| UI kit/forms | Tailwind, shadcn/ui, Lucide, RHF, Zod | Consistent components and fast accessible forms across all four portals |
| Client state | TanStack Query + polling | Cache invalidation and refresh without introducing a socket server |
| Offline | Dexie/IndexedDB + small SW + custom outbox | Persist route/manifest/action/photo locally and explicitly reconcile it; browser connectivity requirement is central |
| Evidence files | Private persistent app-volume + storage adapter | Complete local stack with no hosted account prerequisite; one persistent deployment instance |
| Packaging/QA | npm, Docker Compose, Vitest, Playwright | Fresh installation, reproducible seed and testable cross-role/offline journey |

This is a recommendation based on integration speed and the brief, not a claim that every team is fastest with the same tools. If the submitted prototype is a Vite frontend you may reuse its components/styles, but agree one backend/API and avoid four separate applications. Managed services could work with a full local equivalent, but they add configuration when Compose must start the complete stack. A separate Python/FastAPI service is optional later for Datathon model integration, not part of the Hackathon minimum.

Official references checked when preparing this pack:
- https://nextjs.org/docs/app/getting-started/route-handlers
- https://www.prisma.io/docs/guides/v7/deployment/docker
- https://authjs.dev/getting-started/authentication/credentials
- https://dexie.org/docs/Dexie.js

## Foundation checklist - complete before branching
1. Create GitHub monorepo `TeamName_SolutionName`. Initialize one Next.js App Router TypeScript app at repo root with `src/`, Tailwind, ESLint and `@/*` alias. Copy this pack's files without replacing your initialized app files. Commit the supplied booklet under docs if allowed and link the actual submitted prototype in README.
2. Pick tested exact dependency versions. Use Node 24 LTS and PostgreSQL 17. Pin Prisma CLI/client/adapter to matching 7.x; configure `prisma.config.ts`, explicit client generation path and the pg adapter. Do not use `@latest` blindly after setup. Commit lockfile and use `npm ci` for teammates/CI.
3. Install auth, UI/forms/query/offline/test dependencies once. Initialize shadcn once; add button/input/label/card/table/dialog/select/tabs/badge/textarea/alert/skeleton and one toast mechanism. Lead owns root providers, global theme, responsive shells and navigation.
4. Convert TEAM_CONTRACT into `prisma/schema.prisma`, initial migration and shared Zod/TypeScript DTOs. Add FK/index/unique rules. Transaction helpers must define actor, scope, expectedVersion, idempotency and audit behavior. Agree exact types before portal work.
5. Implement Auth.js Credentials authorize using seeded bcrypt hashes, role redirect and server `requireRole`/scope helpers. Routes and object-level APIs both check scope. Add login-rate limiting suitable for the single-instance deployment, session expiry and logout behavior. Check Origin on custom mutation APIs. Implement shared me/reference endpoints.
6. Import actual organizer CSVs into `data/general/`. Verify headers/units/IDs instead of assuming this contract names match CSV column names. Reject malformed import and count mismatches. Create deterministic seed day plus four linked accounts and overloaded fixtures. If CSVs are unavailable, flag this blocker; do not describe placeholder masters as competition data.
7. Implement server utilities: `db`, standardized responses, Zod parser, idempotency transaction, audit helper, local-time/calendar/cutoff helper, decimal conversions, safe attachment API and private file storage. Define helpers early so portal agents do not invent incompatible ones.
8. Create scaffolds for four portal layouts and route/API/feature folders. Declare contract response types and test fixtures. Fixtures are explicitly development-only; endpoint placeholders return a visible not-implemented error rather than fake successful mutation.
9. Configure scripts: dev/build/start/lint/typecheck/test/test:integration/test:e2e/db:generate/db:migrate/db:deploy/db:seed. `lint` invokes the installed ESLint CLI rather than assuming `next lint` exists. Generate Prisma during build before imports need it.
10. Implement Dockerfile and root docker-compose.yml: `db` healthcheck -> one-shot `migrate-seed` -> `app`. Startup uses committed migrations via migrate deploy and idempotent seed, not dev migration/db push. App waits for setup completion. Seed rerun must not reset completed deliveries or duplicate accounts. Include a private attachment volume and database volume. Migrations/seed runner's image must include its runtime/CLI/tsx dependencies; Next standalone output alone doesn't include the whole seed toolchain.
11. Root .env.example includes DATABASE_URL, app AUTH_SECRET, auth URL/config appropriate to installed version, APP_TIMEZONE=Asia/Colombo, PRIVATE_UPLOAD_DIR, DEMO_SEED=true/false, DEMO_SERVICE_DATE and optional explicitly demo-only clock. No secret in client variables. Compose may supply local-only demo defaults so plain `docker compose up` works; production requires separately set secrets, no destructive demo reset and real credentials configuration.
12. Cold-start verify `docker compose up` brings up the complete stack and seeded data. Verify four real logins, all role layouts, authorized reference APIs and scope-negative calls. Run production build/typecheck. Commit/tag foundation e.g. `setup-v1`, then everyone branches from it.

Do not just run create-next-app and send the repo link. Without seeded schema/auth/contracts/utilities, each portal will invent a different backend.

## How each member starts Claude
Keep all four member files in the shared repo. Start Claude Code at repository root and give the relevant prompt, for example:

```text
Implement the dispatcher vertical slice for Member 1.
Read CLAUDE.md, docs/TEAM_CONTRACT.md, docs/SETUP_AND_HANDOFF.md,
and src/app/dispatcher/CLAUDE.md before editing.
Use the initialized shared foundation and frozen DTOs.
Own dispatcher pages, dispatcher APIs, feature services and tests.
Complete the required working flow, run relevant checks,
and report shared-contract blockers before changing shared files.
```

Member 2: replace dispatcher/Member 1 with loader/Member 2.
Member 3: replace with driver/Member 3; include shared offline transport scope.
Member 4: replace with store/Member 4.

Do not launch all four Claude sessions against the same mutable checkout. Each member uses their own clone/branch. Same-machine sessions require separate git worktrees. These prompts assign human members' work; no extra autonomous agent delegation is required.

## Parallel handoff order
| Gate | What must exist | Consumer |
|---|---|---|
| Foundation | Shared schema/DTOs, auth, UI, CSV seed, Compose and utilities | All four |
| Contract previews | Plan/manifest/order fixtures and endpoint signatures | All four can build UI concurrently |
| Order submission | Real confirmed eligible order and cutoff behavior | Dispatcher |
| Plan publication | Served/deferred decisions, versioned trip/stop manifest | Loader/store |
| Shared offline interface | Dexie outbox/types/hooks and scope behavior | Loader; driver |
| Warehouse release | Correct checked quantities, resolved issues, ready trip | Driver |
| Delivery sync | Actual line outcomes, proof, stop state | Store/dispatcher |
| Receipt | Confirmed/disputed receipt and Issue | Dispatcher monitor |

Merge small vertical slices, not four huge finished branches at the deadline. Contract changes land through lead first. Member 1 engine development and Member 3 offline work run alongside Member 2/4 UI. Member 2/4 help run phone and cross-role tests after their primary flows work.

## Remaining time plan
The booklet deadline is Sunday 4 October 2026 at 23:59 Sri Lanka time. As of this request (3 October morning), roughly 37 hours remain. Avoid a broad new architecture or extras. Suggested checkpoints, adjusted for existing code:
- First 3 hours: freeze foundation/contracts, verify Compose and distribute setup commit.
- Next 8-10 hours: real ordering, manual feasible publishing, loading readiness, basic driver outcomes and receipts. Start offline transport in parallel immediately.
- Next 8-10 hours: full offline reload/photo replay, fairness deferrals, window/fuel validation and race/idempotency checks.
- Remaining time: integration, design fidelity, deploy, seed-reset rehearsal, README/docs, recording and submission buffer. Keep at least 2-3 hours for deployment/video/submission.

If time is short, remove map animation, analytics, automatic route optimization and forecast UI first. Keep all four roles, real constraints, offline recovery, deployed URL and reproducible Compose.

## Final judge walkthrough (put concrete IDs/screens in README)
1. Start stack from clean database; log in as store account. Place or inspect sample eligible order. Demonstrate cutoff with explicit demo clock only if configured/documented.
2. Dispatcher sees same order, prepares overloaded-day plan, validates both capacities/access/refrigeration/windows/fuel, then publishes served and explained deferred decisions.
3. Store sees the same deferral/ETA. Loader sees the versioned manifest and reverse loading sequence.
4. Loader records missing goods; ready blocked. Dispatcher sees Issue. Correct checks and resolve issue through allowed workflow; mark ready online.
5. Driver downloads released route and departs online. Disconnect, record arrival + photo + actual outcome, reload offline, reconnect and synchronize. Retry the same action to demonstrate one proof.
6. Store sees actual delivered quantities and confirms receipt or reports a discrepancy. Dispatcher sees proof and receipt separately.
7. Driver records return; second trip availability and fuel consumption update without duplication.

## Required submission artifacts
- Public deployment URL live for review and four seeded role credentials.
- GitHub monorepo link with root Docker Compose and .env.example; plain Compose startup includes database and seed data.
- README: setup/config, exact accounts, numbered judge walkthrough, seed/demo date, offline behavior, assumptions/limitations, significant Designathon departures.
- docs/architecture.md with a real diagram and docs/data-model.md matching implemented schema; docs/ai-disclosure.md distinguishing assisted versus unassisted work and tools.
- Unlisted YouTube demo video, 5-8 minutes, showing all roles then code/architecture.
- Submit before deadline; booklet says later code pushes are not considered.

## Datathon boundary
Keep future analysis in `datathon/` with its own Python dependencies if needed after Hackathon. Task 1 constructs service/late labels and predicts per delivery_id; 2A forecasts total/chilled volume by depot/brand/week (only Fresh chilled); 2B uses S1 whole-order allocation and its exact feasibility/time rules. Preserve template IDs/row order. Do not assert the Hackathon planner meets Task 2B simply because both assign vehicles. Datathon submission needs its own complete artifacts and evaluation; this pack's four portals do not implement those tasks.
