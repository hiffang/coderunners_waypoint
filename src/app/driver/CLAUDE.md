# Member 3 - Driver portal, proof of delivery and shared offline transport

## Read first and scope
Read root CLAUDE.md and docs/TEAM_CONTRACT.md. Own `src/app/driver/**`, `src/features/driver/**`, `src/app/api/driver/**`, `src/lib/offline/**`, `public/sw.js`, offline shell assets and driver/offline tests. Lead owns the attachment API/storage, auth and Prisma schema. Coordinate service-worker registration with lead; one shared app worker only. Explicitly read this file for feature/API edits outside this folder.

## Outcome
A driver on a personal phone downloads an assigned route, departs after warehouse release, follows stop sequence, records arrivals/outcomes/issues/photo evidence with no connection, and safely synchronizes once. Design actions for use when safely stopped. Do not build interaction that requires tapping while driving. GPS/maps/navigation are optional; a clear list and outlet/district/address data are enough for MVP.

## Screens
1. `/driver`: assigned routes for date, vehicle, trip 1/2, departure and readiness, download-for-offline action, cached timestamp and pending count.
2. `/driver/trips/[id]`: forward stop sequence, window, ETA and goods summary, current stop, loading readiness and version/revision. Online validated 'Depart'; show why not ready. Do not require GPS to continue.
3. `/driver/stops/[id]`: outlet details, planned window, separate order references/lines, safely-stopped 'Arrived', quantities, recipient name and proof controls.
4. Proof/outcome: delivered/partial/failed, actual delivered and damaged line quantities, recipient/note, photo from camera OR file picker, failure reason required. Team MVP requires recipientName OR one photo for successful/partial delivery; state this as a team evidence choice. For failed, require reason and permit photo. Never describe a button tap as signed proof.
5. Issue report: delay/access/other type, severity and note. Offline report says queued, dispatcher notification says synchronized only after server acknowledgement.
6. `/driver/sync`: cached state, pending events/photos, manual retry and conflict list. Show per-event error/recovery, reauthentication and refresh options; preserve unsent evidence.
7. Degradation states: no downloaded route, offline with usable route, photo quota/write failure, expired session during sync, changed assignment/revision conflict. Full offline-reload recovery is essential.

Use mobile cards and large controls, not miniature desktop dashboards. Label local and confirmed progress separately.

## Backend
Implement Member 3 endpoints in shared contract. Derive assignment via authenticated User -> Trip.assignedDriverId/Vehicle. Never authorize with submitted user/vehicle ID alone.

Online `depart` requires ready current revision, correct driver, vehicle availability and sequential trip return. Keep plan immutable after departure. Arrival/outcome/issues use Stop.version, Trip actions use Trip.version. Parent Order changes are transactional and derived from delivered line quantities, not arbitrary client status.

Outcomes verify all submitted lines belong to StopOrder, quantities cannot exceed loaded snapshots, damaged <= delivered, and state transition is valid. Outcome delivered means all expected loaded units delivered without discrepancy; partial/failure has a cause. Do not silently deliver quantities the loader said were absent. Store sees actual delivered lines and proof metadata from shared order DTO.

Validate file IDs belong to uploading driver and can be linked to this stop; use lead attachment service to finalize provisional files. No public upload directories. Atomic mutation includes stop/order updates, proof, audit and idempotency. Attachments uploaded but not linked can be safely retried/cleaned by a documented orphan policy.

`return` requires all stops terminal and records return to home depot. Convert TripFuelReservation from reserved to consumed exactly once; this MVP uses planned liters as estimated actual consumption, labeled accordingly. Actual fuel telemetry is optional. Record return separately from last delivery; trip 2 cannot depart until return synchronized.

## Shared offline implementation - deliver early
Publish a typed interface in `src/lib/offline/index.ts` before finishing driver UI:
- `saveSnapshot(scope, key, data)` and `getSnapshot(scope, key)`;
- `enqueueAction(scope, event)` atomically with optimistic projection;
- `saveEvidenceBlob(scope, clientFileId, blob)`;
- `syncPending(scope)` plus event subscriptions/hooks;
- `getSyncState(scope)` and explicit conflict/discard/retry actions;
- `purgeScope(scope)` guarded against unsynced records.

Use IndexedDB/Dexie and shared event envelope from TEAM_CONTRACT. Implement dependencies so offline arrive followed by outcome does not reuse an obsolete base version. Preserve the eventId and exact normalized payload on ambiguous network timeout. On server replay first check idempotency, then version. For 409 preserve original evidence; fetch current state and require explicit reconciliation, never automatically replay against a new assignment.

Upload Blobs first with persistent clientFileId. Acknowledgement maps client IDs to attachment IDs; an event remains pending until business write acknowledged. Simulate 'server committed but response lost' to verify retry produces one proof, not two. One failed item blocks its dependent chain, not all unrelated stops/trips forever.

Use app-focus/online/manual retry and bounded backoff; background browser scheduling is optional. Expired sessions pause queue, same-account reauthentication resumes. Different-account login must never upload prior account's work. Device time is informational; server times remain authoritative and both are audited. Catch browser storage quota errors and offer actionable recovery; do not announce persistence if a transaction failed.

Build a real offline reload shell. Precache static chunks required by mobile driver/loader views in a production build, and store private snapshots in account-scoped IndexedDB. Avoid caching personalized SSR responses under a URL visible to another login. If using a generic mobile client shell, implement authorized snapshot rendering on reload through that shell and preserve portal URLs. Test with browser reload in offline mode, not merely disconnecting a running page. Service workers require HTTPS or localhost.

Coordinate with Member 2 to consume the same outbox. Lead adds one registration component to root layout. Do not claim Dexie or TanStack Query alone implements offline reload or record reconciliation.

## Phased implementation
A. Shared offline types/transport skeleton to Member 2; assigned route/stop views backed by API.
B. Depart, arrival, actual quantities/outcomes/proof and return API.
C. IndexedDB/photo outbox, dependency/version handling and production offline shell.
D. Conflict/session/storage failures, cross-role tests and phone QA.

## Acceptance and handoff
- Wrong assignment, unready trip, third route, missing required evidence and invalid quantity/state are rejected server-side.
- Route downloaded while online; depart; go offline; record arrival and photo outcome; reload; records and photos persist; reconnect; store/dispatcher see them once.
- Re-send same event and inject response loss after commit: no duplicate proof/audit/fuel consumption.
- Different plan revision returns visible conflict, no overwritten newer plan; departed plan reassignment is rejected.
- Shared loader pending checks work through the transport; account switch never leaks cached routes or syncs another account's events.
- Production service-worker test passes in Playwright at phone size; run strict typecheck/build and meaningful integration tests.
- Hand off the offline helper usage example, delivered order ID and proof API shape to Members 2/4 and lead.
