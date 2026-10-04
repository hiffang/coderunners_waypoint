# Shared offline transport (`@/lib/offline`)

Owner: Member 3. Used by the driver portal now. Member 2 (loader) can use the same outbox, and other portals can adopt it later.
It implements TEAM_CONTRACT section 8. It is client-only, so import it from client components.

## What it is (and is not)

| Piece | File | Job |
|---|---|---|
| IndexedDB (Dexie) | `db.ts` | One database, `waypoint-offline`. Every row carries `scopeKey = role:userId:scopeId` |
| Snapshots | `store.ts` | Server copies you downloaded (`saveSnapshot` / `getSnapshot`). This is the confirmed base |
| Outbox | `store.ts`, `sync.ts` | Queued business writes, each with the contract event envelope |
| Evidence | `store.ts` | Photo blobs stored with the event in **one** transaction |
| Engine | `engine.ts` | Pure send/retry/conflict decisions (unit-tested) |
| Hooks | `hooks.ts` | `useOfflineSnapshot`, `useOutbox`, `useSyncState`, `useAutoSync` |
| Service worker | `public/sw.js`, `service-worker.tsx` | Precaches static portal shells and serves them on offline navigation |

Dexie and TanStack Query alone do **not** give you offline reload or reconciliation. Offline reload comes from the service worker plus a static shell page. Reconciliation is explicit: a 409 becomes a `conflict` and waits for a person to decide.

## Rules the transport enforces

- **Scope.** Rows from one account and scope are never read, sent or purged for another. `syncPending` calls `GET /api/shared/me` first. On 401 the queue is paused (`paused: "auth"`). If a different user is signed in, the queue is also paused (`paused: "account"`). The same user signing in again resumes it.
- **One write path.** Each event is sent to the role's ordinary endpoint with `Idempotency-Key: <eventId>`. There is no second API.
- **Frozen bodies.** Photos are uploaded first to `POST /api/shared/files` (idempotent per `clientFileId`). Their attachment ids are then placed into the body, and the body is frozen (`sentBody`). Every retry sends exactly those bytes with the same key.
- **Ambiguous failure.** A network error or timeout leaves the event `pending`, because the server may have committed. The resend is safe: the server checks idempotency before version.
- **Statuses.**
  - `ack` → `acknowledged` (its photo blobs are deleted locally).
  - `409` → `conflict`, kept with its evidence.
  - `400/403/404/422` → `blocked`, never retried automatically.
  - Network failure or `5xx` → `pending`, with bounded backoff (2 s doubling up to 5 min).
- **Dependencies.** An event waits for its `dependsOnEventIds`. If a dependency is `conflict` or `blocked`, the dependants become `blocked` too. Unrelated events keep flowing.
- **Version chains.** An event built offline on top of another (for example, an outcome after an arrival) carries the *projected* version (`baseVersion`). Once the dependency on the same entity is acknowledged, the event is sent only if the server's returned `version` equals that `baseVersion`. Anything else becomes a visible conflict, never a silent overwrite. **Your endpoint's success `data` must include `version`** for chained events.
- **Storage errors.** Write failures throw `OfflineStorageError`, and `kind: "quota"` means the phone is out of space. Nothing is persisted when that happens, so never tell the user something was saved unless `enqueueAction` resolved.
- **Purge.** `purgeScope(scope)` refuses while unsynchronized events exist (`UnsyncedWorkError`), unless called with `{ discardUnsynced: true }` after the user explicitly confirms.

## Loader example (Member 2)

```tsx
"use client";
import {
  enqueueAction, saveSnapshot, unsettledEvents, useAutoSync, useOfflineSnapshot, useOutbox,
  OfflineStorageError, type OfflineScope,
} from "@/lib/offline";

const scope: OfflineScope = { userId: me.id, role: "LOADER", scopeId: me.depotId! };

// 1. Download while online. Keep the server copy as the confirmed base.
const manifest = await apiFetch<ManifestDto>(`/api/loader/trips/${tripId}`);
await saveSnapshot(scope, `manifest:${tripId}`, manifest);

// 2. Record checks offline. Chain them on earlier unsent checks for the same trip.
const earlier = await unsettledEvents(scope, (e) => e.entityType === "Trip" && e.entityId === tripId);
const projectedVersion = manifest.version + earlier.length; // each acknowledged PUT bumps Trip.version by 1
try {
  await enqueueAction(scope, {
    entityType: "Trip",
    entityId: tripId,
    endpoint: `/api/loader/trips/${tripId}/checks`,
    method: "PUT",
    payload: { expectedVersion: projectedVersion, planRevision: manifest.planRevision, checks },
    baseVersion: projectedVersion,
    planRevision: manifest.planRevision,
    dependsOnEventIds: earlier.map((e) => e.eventId),
    label: `Checks for ${manifest.vehicleId} trip ${manifest.tripNumber}`,
    kind: "loader.checks",
    meta: { tripId },
  });
  toast.success("Saved on this tablet; sent when online");
} catch (err) {
  toast.error(err instanceof OfflineStorageError ? err.message : "Not saved");
}

// 3. Keep it moving and render base + queued work, labelled separately.
useAutoSync(scope);
const base = useOfflineSnapshot<ManifestDto>(scope, `manifest:${tripId}`);
const queued = useOutbox(scope)?.filter((e) => e.meta.tripId === tripId && e.status !== "acknowledged");
```

`ready` stays online-only (TEAM_CONTRACT section 8). Do not queue it.

## Offline reload (service worker)

- `public/sw.js` precaches **static, cookie-less** shell pages: `/driver/shell` now, and `/loader/shell` once Member 2 adds one. It also caches every `/_next/static` asset those pages reference.
- When a navigation to `/driver/...` or `/loader/...` fails, the worker serves that portal's cached shell **under the original URL**. The shell reads `window.location` and renders from IndexedDB for the account last verified online (`rememberAccount` / `getActiveAccount`).
- The worker never caches `/api/*` responses or personalized pages, and never touches non-GET requests.
- For a loader shell: add `src/app/loader/shell/page.tsx` with `export const dynamic = "force-static"` and no session reads, mirroring `src/app/driver/shell/page.tsx`. The worker already lists it.
- To test: `npm run build`, start the production server, open the portal once online, tap *Download for offline*, then go offline and **reload**. Dev mode does not register the worker unless `NEXT_PUBLIC_ENABLE_SW=true`.

## For the lead

1. **One registration.** `ServiceWorkerRegistration` is mounted in the driver layout and shell page for now. Move it to `src/app/layout.tsx` (and remove it from the driver files) once other portals need it.
2. **Sign-out.** The shared user menu calls `signOut()` directly, so a driver's cached route stays in IndexedDB until the next account uses the device. The driver *Sync* screen has a guarded "Sign out and clear this phone" (`purgeScope` and then `signOut`). Consider routing the menu's sign-out through the same guard.
3. **Route group.** The driver pages moved to `src/app/driver/(portal)/` so that `/driver/shell` can sit outside the authenticated layout. URLs are unchanged.

## Driver API shapes (for Members 1, 4 and the lead)

All mutations require `Idempotency-Key`, a same-origin `Origin` header and the DRIVER role. Assignment always comes from `Trip.assignedDriverId === session user`. Success `data` is a `DriverMutationResult` (`src/features/driver/types.ts`):
`{ entityType, entityId, tripId, version, state, serverAt, proofId?, issueId?, attachmentIds?, fuel? }`.

| Endpoint | Body | Effect |
|---|---|---|
| `GET /api/driver/trips` | `?serviceDate` optional | Assigned trips in published plans, with `departure: { canDepart, blockers[] }` |
| `GET /api/driver/trips/[id]` | none | `DriverSnapshotDto` + `departure` + `depotName` |
| `POST /api/driver/trips/[id]/depart` | `{expectedVersion, planRevision, clientAt}` (Trip.version) | READY → IN_TRANSIT. Online only. 409 `INVALID_TRANSITION` with `details.blockers` |
| `POST /api/driver/stops/[id]/arrive` | same (Stop.version) | PENDING → ARRIVED. Earlier stops must be terminal |
| `POST /api/driver/stops/[id]/outcome` | `stopOutcomeSchema` | ARRIVED → DELIVERED/PARTIAL/FAILED. Creates the proof, line outcomes and attachment links. Order status is derived from line quantities |
| `POST /api/driver/stops/[id]/issues` | `driverIssueSchema` | Non-blocking Issue on trip + stop. Bumps Stop.version |
| `POST /api/driver/trips/[id]/return` | `{expectedVersion, planRevision, clientAt}` | All stops terminal → COMPLETED. Fuel RESERVED → CONSUMED exactly once (planned litres, labelled as an estimate) |

How outcomes are checked:

- **Line coverage.** Every submitted line must belong to the stop's orders. DELIVERED and PARTIAL must list every line.
- **Quantity limits.** `delivered <= loader's loadedUnits` and `damaged <= delivered`.
- **DELIVERED.** Every ordered unit was loaded and handed over undamaged.
- **PARTIAL.** Needs a reason (`failureReason` or `note`) and at least one delivered unit.
- **FAILED.** Needs a reason and hands over nothing.
- **Evidence.** This is the team rule: DELIVERED and PARTIAL need `recipientName` or one photo.
- **Photos.** Evidence ids must be this driver's own, still-unlinked uploads.

**Order status.** An order becomes DELIVERED when every line was delivered undamaged. If some units arrived, it becomes PARTIALLY_DELIVERED. If nothing was handed over, it stays ALLOCATED, and the dispatcher defers it explicitly.

**What the store sees.** `toOrderDto` already exposes `lines[].deliveredUnits/deliveryDamagedUnits` and `delivery.{stopState,outcome,recipientName,failureReason,submittedAt,evidence[]}`.

**Orphan policy.** Uploads stay provisional (`linkedAt = null`) until an acknowledged outcome links them. The outbox re-uses the same `clientFileId` on retry, so an upload is never duplicated. Unlinked rows older than 24 h are orphans and safe to clean (CONTRACT_V1).
