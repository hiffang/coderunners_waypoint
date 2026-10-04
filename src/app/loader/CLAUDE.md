# Member 2 - Loader portal and warehouse execution

## Read first and scope
Read root CLAUDE.md and docs/TEAM_CONTRACT.md. Own `src/app/loader/**`, `src/features/loader/**`, `src/app/api/loader/**` and loader tests. No second manifest schema or auth system. Coordinate with Member 3 for shared outbox helpers; do not create another service worker or retry transport. Read these instructions explicitly when editing outside this directory.

## Outcome and users
A loader at Peliyagoda or Kandy uses a shared tablet/terminal, but judges also test a phone. They see the latest published plan, prepare goods in a sensible loading order, flag shortfall/damage before departure, and release a checked vehicle. The server-scoped depot controls which trips are visible.

## Screens
1. `/loader`: today's published trips, vehicle/type, brand, departure, trip number and planned/loading/ready status. Include latest plan revision, last sync and blocking issue count.
2. `/loader/trips/[id]`: manifest with delivery sequence AND suggested loading sequence. For the MVP choose reverse-stop loading, explicitly label it 'Load last delivery first'; delivery remains forward sequence. State this physical loading assumption rather than claiming an optimized warehouse algorithm.
3. Line checklist: order/outlet reference, expected/loaded/damaged units, temperature and handling labels, check action and validation. Prefer large tap controls, explicit numbers and sections; no dense desktop table on 375px. Source unit weight/volume from frozen planned order lines, never retype totals independently.
4. Shortfall/damage report: order/line, quantity, type/severity, reason and optional note. Show that the dispatcher was notified once server acknowledged; offline issues remain 'queued'.
5. Readiness summary: unchecked lines, shortfalls, blocking issues and revision age, then online 'Mark ready'. Explain every disabled release condition.
6. Degradation screen: stale or changed manifest, unsynced work and blocked release. Let users inspect pending work, fetch the new revision, then explicitly reconcile relevant lines. Never discard an unsynced check silently.

Follow the submitted prototype and shared UI tokens. Shared-terminal logout must not expose another user's cached manifest.

## Backend
Implement Member 2 endpoints in TEAM_CONTRACT. Every query/mutation checks loader role and depot ownership through actual Trip/Plan/Depot relations. A passed depotId from the browser does not grant access.

`start` requires published current revision and planned trip. `checks` validates each orderLine belongs to the trip, units are nonnegative integers and loadedUnits <= expectedUnits; damagedUnits <= loadedUnits. Enforce expectedVersion and planRevision. Each batch is atomic, bumps Trip.version once and records audit. Blank/unchecked differs from deliberately loaded zero. Idempotent replay returns the original result.

A shortfall/damage opens a blocking Issue and is visible in dispatcher monitor. A check update to full undamaged goods does not erase issue history; record resolution under the agreed feature service and audit or wait for dispatcher acknowledgement. Readiness requires both verified quantities and resolved blocking issues. Do not bypass with a UI 'override' checkbox.

`ready` requires online authoritative current revision, all relevant checks complete, correct quantities/temperature labels and no blocking issues. Loading state -> ready only once; wrong revision/state is 409. Do not edit loading quantities after trip has departed. A plan revision change invalidates readiness. The driver must see the ready status persisted by this endpoint; do not provide a separate driver-side fake release.

## Offline use
Consume Member 3's shared `src/lib/offline` API. Cache only this user's permitted manifests. Offline checks/issues enter Dexie outbox and update local projections; clearly show pending count. On reconnect, replay events through these loader APIs and shared idempotency. Queued checks and issue events on the same Trip depend on earlier local events; propagate acknowledged versions only along that chain. A different server revision pauses the queue for explicit review.

'No downloaded manifest' is a full recovery screen, not empty success. 'Ready' requires connection and server confirmation. If transport integration is not yet ready, build to the agreed helper interface and test fixtures; do not replace the offline requirement with localStorage or optimistic toasts.

## Phased implementation
A. List/detail from real plan API and responsive reverse-stop manifest.
B. Loading start, persisted line checks, shortfall/damage Issues and online readiness.
C. Cached manifests, queued checks and conflicts using shared transport.
D. Phone QA, accessibility and design comparison.

## Acceptance and handoff
- At 375px, all essential actions/labels remain usable without horizontal scrolling.
- Wrong depot, unknown line, stale version/revision, negative/overloaded quantities and edits after departure are rejected by server tests.
- Simulate missing/damaged goods: dispatcher sees the issue, ready is blocked, corrective checks plus issue resolution allow ready.
- Modify plan while loading: stale checks cannot release the revised trip.
- Offline checks survive reload and sync once; resend same event produces no duplicate issue/check/audit effects.
- Driver sees the released manifest and cannot depart until it is ready.
- Run relevant tests/typecheck/build. Hand off a ready trip ID, revision, version and missing-stock recovery example to Member 3 and lead.
