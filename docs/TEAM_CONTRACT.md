# Shared implementation contract - version 1

This is the team's proposed contract, grounded in the booklet. It is not a claim about CSV headers or existing code. The lead translates it to Prisma and Zod, verifies against the actual supplied CSVs, freezes version 1 and distributes the same commit. Every member implements these meanings. Changes after freezing are coordinated and versioned.

## 1. Booklet requirements versus team choices
The shared network has 120 outlets, two depots (Peliyagoda and Kandy), and 60 vehicles: 12 refrigerated trucks, 40 dry-box trucks, eight vans; four vans are refrigerated. That is 16 chilled-capable vehicles, not 12. Vehicles belong to one home depot, have both weight and volume limits and a weekly fuel quota, and can run at most two routes per day. Driver availability is not an extra allocation constraint for the existing fleet. Operating days come from calendar.csv, Monday-Saturday. Validate imported counts and integrity; don't fabricate shared records if the CSVs are missing.

Fresh dry and chilled orders can exist separately for the same outlet/day. Never identify an order by outlet/day alone. Style orders weekly; Tech as needed. Orders close at 16:00 Asia/Colombo for the next operating day's run. After-cutoff orders wait for the following run. The team chooses arrival-window feasibility as arrival <= closing time, with early arrival waiting until opening; handling may continue after closing unless the provided design says otherwise. Record this assumption.

**Do not conflate Hackathon planning with Datathon Task 2B.** Same-brand/same-district trips, whole orders, the special 270/480-minute budgets and exclusion of return travel are explicit Task 2B rules (booklet pp. 20-21). For the Hackathon MVP, whole-order allocation and single-brand/single-district trips are simplifying choices; label them as such. Hackathon route timing and fuel calculations must include return travel and sequential trip availability. Do not claim a normal Hackathon plan passed the Task 2B checker without implementing that checker's exact scenario rules separately.

## 2. Identity, units and time
- Imported Outlet and Vehicle IDs remain the supplied string IDs. Internal entities use UUIDs; order references are immutable, human-readable and unique.
- Keep imported enum values in raw import metadata where useful; map them once to canonical enums. Reject unknown capability/access data instead of guessing.
- Dates such as serviceDate and requestedDate are `YYYY-MM-DD` interpreted in Asia/Colombo. Instants are ISO-8601 UTC timestamps. Opening/closing times are Sri Lanka local HH:mm, materialized for a given service date on the server.
- Server-received timestamp determines order cutoff. An offline/client timestamp cannot backdate acceptance. Define exactly-at-16:00 as closed. The team lead tests Friday/Saturday, Sunday skipping and calendar exceptions.
- Store weights/volume/fuel as database decimals; expose numeric DTOs with fixed conversion/rounding in one helper. Compare constraints with a documented small tolerance; rounding in UI must not permit overload.
- Fuel is liters. If a vehicle source gives km/l, convert to liters/km once. Weekly ledger key is vehicleId + ISO year + ISO week in Sri Lanka time. Trips include round-trip distance.

## 3. Models to create before portal work
This is a minimum field specification, not an executable Prisma schema. Lead adds relations, indexes, FK constraints and timestamps. Mutable aggregate rows have integer `version`, initially 1. Child writes bump the parent version.

| Model | Essential fields / constraints |
|---|---|
| User | id, unique email, passwordHash, name, role, depotId?, outletId?, vehicleId?, active; role is dispatcher/loader/driver/store_manager |
| Depot | id, unique name |
| Outlet | supplied id, brand fresh/style/tech, district, depotId, dockType, parkingConstraint, opening/closing local times, mall window metadata; imported raw fields |
| Vehicle | supplied id, depotId, type truck/van, refrigerated boolean, weightCapKg, volumeCapM3, fuelLitersPerKm, weeklyFuelQuotaLiters, status available/in_workshop; driver account mapping |
| CalendarDay | date, operating boolean, isoYear, isoWeek, payday/festival/monsoon flags from supplied calendar |
| Order | id, unique orderRef, outletId, createdBy, brand, temp ambient/chilled/frozen, requestedDate, eligibleServiceDate, submittedAt?, totals, status, version |
| OrderLine | id, orderId, description, orderedUnits, unitWeightKg, unitVolumeM3; totals validated server-side |
| Plan | id, depotId, serviceDate, revision, status draft/published/completed, version; only one active published plan per depot/date |
| AllocationDecision | id, planId, orderId, decision served/deferred, tripId? and stopId?, reasonCode?, reasonText?, nextEligibleDate?; unique planId/orderId |
| Trip | id, planId, vehicleId, assignedDriverId, tripNumber 1/2, brand, district, plannedDepartureAt, plannedReturnAt, distanceKm, reservedFuelLiters, state, planRevision, version |
| Stop | id, tripId, outletId, sequence, plannedArrivalAt, etaAt?, plannedServiceMin, state, actualArrivalAt?, completedAt?, version; unique tripId/sequence |
| StopOrder | stopId, orderId; order appears in at most one active served allocation; separate dry/chilled orders remain distinct |
| LoadingCheck | id, tripId, orderLineId, expectedUnits, loadedUnits, damageUnits, note?, checkedBy, checkedAt; unique tripId/orderLineId |
| Issue | id, type shortfall/damage/delay/access/receipt/other, severity, orderId?, tripId?, stopId?, reporterId, text, status open/acknowledged/resolved, resolution?, resolvedBy?, version |
| ProofOfDelivery | id, stopId, outcome, recipientName?, note?, evidenceFileIds, capturedAt, submittedAt, recordedBy; failure reason required for failed |
| DeliveryLineOutcome | stopId, orderLineId, loadedUnitsSnapshot, deliveredUnits, damagedUnits; never exceed loaded units |
| Receipt | id, orderId unique, storeUserId, receivedAt, note?, status confirmed/disputed, version |
| ReceiptLine | receiptId, orderLineId, receivedUnits, damageUnits; compared against DeliveryLineOutcome |
| Attachment | id UUID, uploadedBy, MIME, size, private storageKey, owner scope/link; no raw filesystem path in DTO |
| AuditEvent | id, actorId, entityType/id, action, before/after summary, serverAt, clientAt?, planRevision?; append only |
| IdempotencyRecord | actorId, eventId, requestHash, committed response/status; unique actorId/eventId |
| VehicleWeekFuel | vehicleId, isoYear, isoWeek, quotaLiters, reservedLiters, consumedLiters, version |
| TripFuelReservation | tripId unique, vehicle-week FK, liters, state reserved/consumed/released |

Do not use a mutable deferredCount as the sole fairness history. Query distinct historical published service days where an order/outlet was deferred, plus last served date. Avoid counting draft edits as repeated deferrals.

## 4. Independent state machines
Order: draft -> confirmed (eligible and accepted) -> allocated (published plan) -> delivered or partially_delivered -> received. confirmed -> deferred at publication; deferred -> allocated on a later run. Draft/editing and cancellation are allowed only before planning/cutoff and under Member 4's rules. A cancelled order cannot be allocated. Driver failure leaves the order allocated with a failed stop; dispatcher records the next-run deferral explicitly. Deferred is a decision, not delivery failure.

Trip: planned -> loading -> ready -> in_transit -> completed. Member 2 changes loading/ready; Member 3 changes in_transit/completed. Member 1 publishes/revises only trips not departed. Active loading invalidates readiness when its revision changes. Published plan revisions lock departed routes against reassignment. A completed vehicle trip includes return to depot; route 2 cannot depart before route 1's actual return.

Stop: pending -> arrived -> delivered/partial/failed. Do not make driver-arrived and store-received the same event. A receipt dispute creates Issue and Receipt.disputed; it does not erase driver evidence or set a delivery back to pending. Stops are sequenced; one Stop may have several distinct orders at that outlet if temperature/capacity constraints allow co-loading.

Completion owners:
- dispatcher: decisions, plans, allocation, planned timing and fuel reservation;
- loader: loading checks, issues, ready status;
- driver: trip departure/return, stops, proof, line delivery outcomes, fuel consumed ledger updates;
- store: order submission/edit, receipt and receipt issues.
Changes to another aggregate's derived status happen in a shared transaction helper owned by the relevant feature; avoid dueling generic PATCH endpoints.

## 5. API conventions
Base `/api`, JSON and same-origin session cookies. Every mutation verifies Origin/CSRF as appropriate, authenticates server-side, authorizes the actual row scope and validates input. Queries are scoped server-side, never filtered only in the browser. Use Node runtime for Prisma/files.

Successful responses: `{ data: T, meta?: { version?: number, serverTime?: string } }`.
Errors: `{ error: { code: string, message: string, fieldErrors?: Record<string,string[]>, currentVersion?: number } }`.
HTTP 401 login needed; 403 forbidden; 404 missing/not-visible; 409 stale version, plan revision or invalid transition; 422 validation/constraints; 503 retryable dependency failure.
Lists: `?serviceDate=YYYY-MM-DD&cursor=...&limit=50`, with `{data:{items:T[],nextCursor:string|null}}`; role-specific filters documented by owner. UUID resource parameters, not array indexes.
Mutation body carries `expectedVersion` where target already exists. Header `Idempotency-Key` is a client-generated UUID for the action, reused on retry. The server hashes the normalized request + endpoint and atomically stores the result with effects. Same key/different payload is 409. Retry returns the original result even if the entity has subsequently advanced. Do this check before stale-version rejection. Different browser events do not share a key.

## 6. Endpoint ownership and payloads
All listed paths are required contract targets; lead creates response types in `src/lib/contracts`. Member owns implementation under their API directory. Additional read filters are fine; renaming these paths requires coordination.

| Owner | Endpoint | Input / result semantics |
|---|---|---|
| Lead | GET /shared/me | userId, role, authorized depot/outlet/vehicle, timezone |
| Lead | GET /shared/reference | role-visible outlets, vehicles, calendar; IDs preserved |
| Lead | POST /shared/files | multipart Blob + clientFileId; authorized provisional upload, MIME jpg/png/webp, max 5MB; idempotent attachmentId |
| Lead | GET /shared/files/[id] | authorized streamed attachment; no public access |
| M1 | GET /dispatcher/orders | eligible confirmed/deferred queue, lines, prior deferrals, eligibility and dates |
| M1 | GET /dispatcher/plans | plan list for selected depot/day |
| M1 | POST /dispatcher/plans | {depotId,serviceDate}; create draft id/version |
| M1 | GET /dispatcher/plans/[id] | plan, decisions, trips, stops, utilization, issues |
| M1 | POST /dispatcher/plans/[id]/allocate | {expectedVersion}; deterministic assisted allocation, draft only |
| M1 | PUT /dispatcher/plans/[id]/decisions | {expectedVersion,decisions:[{orderId,decision,vehicleId?,tripNumber?,stopSequence?,reasonCode?,reasonText?}]}; validate entire candidate, replace draft decisions atomically |
| M1 | POST /dispatcher/plans/[id]/validate | {expectedVersion}; read-only validation result; does not reserve fuel |
| M1 | POST /dispatcher/plans/[id]/publish | {expectedVersion}; revalidate and atomically reserve fuel, decisions/status/audit |
| M1 | POST /dispatcher/orders/[id]/defer | {expectedVersion,reasonCode,reasonText}; only a fully failed terminal delivery, no active/pending served stop; mark next eligible run and preserve original allocation history |
| M1 | GET /dispatcher/monitor | trips, stop/receipt statuses, last update, issues |
| M1 | POST /dispatcher/issues/[id]/resolve | {expectedVersion,resolution}; acknowledge/resolve, never silently waive missing goods |
| M2 | GET /loader/trips | scoped depot's published trips/load readiness |
| M2 | GET /loader/trips/[id] | manifest, revision, stop sequence, order lines, checks, issues |
| M2 | POST /loader/trips/[id]/start | {expectedVersion,planRevision}; planned -> loading |
| M2 | PUT /loader/trips/[id]/checks | {expectedVersion,planRevision,checks:[{orderLineId,loadedUnits,damageUnits,note?}]}; parent Trip.version bumps |
| M2 | POST /loader/trips/[id]/issues | {expectedVersion,planRevision,type,severity,orderId?,text}; block readiness if unresolved shortfall/damage |
| M2 | POST /loader/trips/[id]/ready | {expectedVersion,planRevision}; all checks complete and no blocking issue |
| M3 | GET /driver/trips | assigned driver/vehicle routes for day |
| M3 | GET /driver/trips/[id] | versioned complete authorized snapshot including stop/order/line/revision |
| M3 | POST /driver/trips/[id]/depart | {expectedVersion,planRevision,clientAt}; ready -> in_transit; requires online authoritative release |
| M3 | POST /driver/stops/[id]/arrive | {expectedVersion,planRevision,clientAt}; pending -> arrived |
| M3 | POST /driver/stops/[id]/outcome | {expectedVersion,planRevision,outcome,recipientName?,note?,failureReason?,evidenceFileIds,lines:[{orderLineId,deliveredUnits,damagedUnits}],clientAt}; stop and orders/evidence transaction |
| M3 | POST /driver/stops/[id]/issues | {expectedVersion,planRevision,type,severity,text,clientAt}; bump Stop.version |
| M3 | POST /driver/trips/[id]/return | {expectedVersion,planRevision,clientAt}; all stops terminal, returned to home depot, complete trip, convert reservation to consumption once |
| M4 | GET /store/orders | own outlet order list, decisions, ETA and receipt eligibility |
| M4 | POST /store/orders | {requestedDate,temp,lines:[{description,orderedUnits,unitWeightKg,unitVolumeM3}]}; submit, derive outlet/brand/totals/eligibility from session/server |
| M4 | GET /store/orders/[id] | own order, allocation/deferral, lines, ETA, delivered quantities, proof summary, receipt |
| M4 | PATCH /store/orders/[id] | {expectedVersion,requestedDate?,temp?,lines?}; only editable confirmed/unplanned before cutoff; no history destruction |
| M4 | POST /store/orders/[id]/cancel | {expectedVersion,reason}; only before lock/cutoff |
| M4 | POST /store/orders/[id]/receipt | {expectedVersion,lines:[{orderLineId,receivedUnits,damageUnits}],note?}; distinct Receipt, discrepancies make disputed+Issue |
| M4 | POST /store/orders/[id]/issues | {expectedVersion,type,severity,text}; own order/outlet only |

A fully failed delivery can be deferred by the dispatcher for a later run after the old stop is terminal. Preserve the historical served decision; the next published allocation is a new service-day decision. A partial delivery must not requeue the full original order: keep it as partially_delivered and create a clearly linked follow-up order for undelivered units if this recovery is implemented. For MVP the store can explicitly place the replacement order; show this limitation and preserve the partial receipt.

A shared order DTO contains id/orderRef, outletId/name, brand/temp, requestedDate/eligibleServiceDate, status/version, totals, lines, allocation?, deferral?, delivery?, receipt?. Never make store readers depend on loader's UI shape.
A manifest DTO contains trip id/version/planRevision/state, vehicle capacity, planned departure/return, stops ordered by sequence, linked orders and lines and current checks.
A driver snapshot extends the manifest with actual events, visible issues and attachment metadata. Member 3 may use this without giving the driver access to all depots' manifests.

## 7. Constraint validation and publication
One Member 1 engine handles manual and assisted allocation. Validate:
1. Eligible operating date, correct depot, confirmed/deferred non-cancelled order, not already served in another active plan. Every queue order has exactly one decision; order identity, not outlet identity.
2. Vehicle available, correct home depot, at most two trips across all active plans that service day, assigned existing driver. Reserve the relevant vehicle-day in the publication transaction.
3. Every chilled/frozen order uses refrigeration, every van_only outlet uses van. Refrigerated vehicles may carry ambient. Preserve chilled-capable vans when prioritizing limited capability.
4. Per-trip total weight and volume within limits, orders whole under MVP policy. Capacity resets only after return/reload; day fuel does not reset between trips.
5. Sequential stop schedule from departure, outbound/inter-stop travel, wait until opening, service time, final return. All arrivals <= the individual closing window; Fresh before 08:00 AND its own closing window. Mall access enforced. Trip 2 departs after trip 1 return/reload. Use source travel data if available; explicitly document estimate inputs if not.
6. Round-trip distance * liters/km plus existing reserved/consumed weekly fuel <= quota. Multiple plans cannot spend the same fuel. Publication locks ledgers, replaces an older revision's unconsumed reservations rather than adding twice, and writes audit records. Never release consumed fuel on edits.
7. Deferred decisions require code, explanation and next eligible run. Exceptions list states the exact cause, order and exceeded amount.

Priority is explainable, not asserted optimal: scarce refrigerated van orders, prior unserved days, Fresh urgency and tighter windows, then other orders with deterministic tie-breaks. Protect capability-constrained orders; show tradeoff when a different priority would defer another brand. The lead approves the final policy.

## 8. Offline contract (Member 3 implements shared transport)
Dexie stores partitioned by userId + role + authorized scope: snapshots, pendingEvents and attachments. Pending event: `{eventId,userId,role,entityType,entityId,endpoint,method,payload,baseVersion,planRevision,dependsOnEventIds,clientAt,status,retryCount,lastError?}`. status is pending/sending/acknowledged/conflict/blocked. Persist event and optimistic projection together before announcing 'saved offline'. Keep cached base plus queued projection separate.

Resolve dependency acknowledgements and file-ID mappings before the first send; freeze the transmitted body and its request hash from that first send onward. Never change expectedVersion or file IDs when retrying an ambiguously completed request.

The outbox calls each role's ordinary endpoint with the same Idempotency-Key; there is no second write path. File Blobs upload first, clientFileId is idempotent, then outcome references attachment IDs. If offline arrive is followed by outcome, queue outcome's dependency on arrive; after acknowledgement use the returned version for the dependent command, but only if it extends that acknowledged local chain. An unrelated server revision/change gives a visible conflict, not a blind version overwrite. Stop events and Trip events have separate versions.

Retry on online event, app focus and 'Sync now'; use bounded backoff for network/5xx. Background Sync is optional, not required for reliability. Actual request failure determines connectivity. Retain 401 work until same user reauthenticates; pause 409 work for explicit recovery; do not retry 403/422 forever. Do not clear a queue on an ambiguous HTTP timeout. Check idempotency on retry before version; server may have committed the timed-out action.

Loader can record checks/issues offline against a cached manifest, but **ready** requires online validation. Driver can read routes, record arrival/outcomes/issues/photo while offline after download, but **depart** requires online authoritative loading/plan validation. This is a documented MVP safety choice; implement a clear degradation screen if there is no route snapshot. Trip return can queue offline but blocks online departure of trip 2 until synchronized. Offline store ordering/receipts are optional; if added, confirmation/cutoff use server acceptance and offline receipts remain pending.

Service worker caches versioned static assets and an authenticated mobile shell deliberately preloaded while online. Offline reload must work in production, not just a mounted component. Private role data goes in scoped IndexedDB, not a globally shared SW API cache. Do not cache login/API mutation requests. On logout purge private snapshots for that account after handling pending records; if pending work exists, prompt to sync or explicitly discard. Never send another user's pending events under a newly logged-in session. Do not erase unsynced proof automatically during cache upgrades.

## 9. Seed and integration contract
Actual General Data CSVs have not been attached with this booklet. Download the organizers' supplied datasets separately, verify headers and retain IDs. A sample fixture is a development aid, not the required final seed. Lead owns raw CSV mapping, idempotent imports and one deterministic judge-day scenario.

Seed four documented accounts (one per role), tied to the same demonstration depot, driver vehicle and store outlet. Include the complete 120/60/two-depot/calendar masters and a reproducible sample day with separate ambient/chilled Fresh orders, a van_only order, volume-heavy Style, weight-heavy Tech, one capacity-driven deferral, and a loading issue. Extra related seed orders make constraint checks visible; never invent fields in the original CSVs.

Judge journey: store submits eligible order -> dispatcher creates/validates/publishes plan plus explained deferral -> loader flags shortfall -> dispatcher sees issue -> loader corrects loaded goods/resolves through allowed workflow -> online ready -> driver downloads/departs -> offline arrival/photo/outcome/reload -> reconnect/retry same event -> store sees actual delivery, confirms or disputes -> driver return -> dispatcher sees outcome and receipt. Judge can use separate browsers/contexts; only four accounts are required, not a client role-switch bypass.

Add a protected demo reset script or CLI, never an anonymous production reset endpoint. Document the scenario date and seed mode so the cutoff can be demonstrated honestly even if judges review on a later date. Production acceptance uses real server time; optional demo clock must be explicit, server-only, consistent across roles and disabled outside the demo environment.
