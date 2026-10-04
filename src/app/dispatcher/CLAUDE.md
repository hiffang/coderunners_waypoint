# Member 1 - Dispatcher portal and allocation engine

## Read first and scope
Read root CLAUDE.md and docs/TEAM_CONTRACT.md. You own `src/app/dispatcher/**`, `src/features/dispatcher/**`, `src/app/api/dispatcher/**` and dispatcher tests. Do not change shared schema/DTOs/auth or another portal. If you are the lead, finish SETUP_AND_HANDOFF first and commit it separately. These instructions apply to your API/feature folders too, even though this file lives under the portal route.

## Outcome
An authorized dispatcher at a depot can see the closed order queue, create a feasible allocation for an overloaded day, explain every deferral, publish it and see loader/driver/store feedback. Manual planning with robust validation satisfies the booklet; deterministic assisted allocation is the preferred convenience. Never call a greedy allocation globally optimal.

## Screens
1. `/dispatcher`: day's depot KPIs, unplanned orders, unserved history, available fleet, delivery progress and exceptions. Data comes from APIs; depot is an authorized server scope.
2. `/dispatcher/orders`: filter by brand/temp/district/access and service date; show separate orders for an outlet, cutoff, totals and prior skipped days.
3. `/dispatcher/plans/[id]`: queue and trip builder, explicit vehicle/trip selection, stop ordering, both capacity bars, refrigeration/access tags, departure/arrival/return and fuel usage. Side panel shows why an assignment fails. Prefer click-to-assign and move controls; drag/drop is optional.
4. `/dispatcher/deferrals`: order reference, reason, history, next run and fairness consequences. Source AllocationDecision, not a separate disconnected list.
5. `/dispatcher/monitor`: live-ish polling of trips/stops, loading issues, proofs and receipt disputes; include last refreshed time and stale-data message. Updates within about 10 seconds while online are sufficient; WebSockets are unnecessary for MVP.
6. A fully implemented infeasible-plan screen: show orders lacking refrigerated vans, which capacity/window/fuel constraints block them, validation detail, and actions to reassign/defer. Do not show a green publish button while unresolved constraints remain.

Match the submitted prototype. Desktop table views must reflow on small screens; avoid making a map the only way to see trips.

## Engine implementation
Build pure functions under `src/features/dispatcher/server/planning/`: candidate eligibility, capability compatibility, capacity aggregation, schedule construction, round-trip fuel, whole-plan validation, priority score explanation and deterministic allocation. Tests call these without UI or database. A service orchestrates reads and transactions.

First implement manual decisions and the exact shared validator. Then add assisted allocation using stable priority tiers. Choose compatible vehicles/trips, reserve forecast daily/weekly resources in memory during allocation, and validate the final candidate. Keep dry goods from needlessly consuming the last refrigerated van. Sort by prior distinct missed service days and delivery urgency inside capability tiers. Keep remaining orders deferred with clear causes. Distinguish impossible compatibility from policy-based deferral; recommend alternative manual choices when feasible.

Hackathon single-brand/single-district trips are an MVP simplification, not a blanket booklet requirement. Do not import Task 2B's no-return formula or 270/480 budgets into Hackathon validation. Use real windows and sequential trips. Provided service allowances are estimates, not Datathon predictions. If data is insufficient to calculate a route, fail visibly with an explainable missing-input reason or an explicitly configured/documented estimate, never silently default to zero travel/fuel.

Example rejected assignments: ambient truck/chilled order; truck/van_only outlet; Kandy vehicle/Peliyagoda order; summed volume too high despite spare weight; third daily trip; ETA after mall window; second route before first return; weekly quota already reserved by another plan. Fresh before 08:00 must not override a stricter outlet window.

## Backend and shared behavior
Implement the Member 1 endpoints in TEAM_CONTRACT. Load plans by ID and authorized depot. Persist decisions per order. Every eligible queue order gets served or deferred exactly once at publish; unassigned is allowed only in draft. All draft edits use expectedVersion. Validate on edit and revalidate transactionally on publish. Never rely on browser capacity bars for feasibility.

Publishing transitions relevant orders to allocated/deferred, creates trip/stop linkage, reserves fleet/fuel and audit events atomically. Use vehicle-day/ledger locks or serializable transactions to prevent competing plans overspending resources. Draft validate does not consume fuel. Retrying publish is idempotent. Version 2 replaces unconsumed reservations from version 1 once, without releasing actual consumed fuel.

Plan edits after loading starts increment revision and invalidate checks/readiness that no longer match. Loader receives a conflict and must refresh, not keep using obsolete quantities. Departed trips are immutable; do not silently reroute cached driver work. After departure, communication is an Issue rather than editing an old stop behind the driver.

Resolve dispatcher issues with an audit entry. Acknowledging a shortfall is not the same as replacing missing stock; the loader must record corrected checks before ready. For MVP, unsolved shortfalls block departure. Show receipts separately from driver proof.

## Phased implementation
A. Connected queue, shared plan DTO and manual allocation with validator.
B. Publication, fuel reservations, deferrals and loader-visible manifest.
C. Monitor, issue recovery and assisted allocation.
D. Reconcile design and polish; optional future-capacity view only after required flow is verified. Label heuristic forecasts as estimates; no synthetic ML claims.

## Acceptance and handoff
- Unit tests for every constraint listed above and multiple orders at one outlet.
- Integration test: duplicate publish creates no duplicate stop/reservation; concurrent plans cannot claim the same vehicle or fuel; failed publication rolls back entirely.
- Deferral explanation visible in Member 4 portal; plan visible in Member 2 portal; actual delivery/receipt visible in monitor.
- Loading revision conflict is demonstrable, and cannot invalidate a departed route.
- API rejects wrong-role/wrong-depot calls; production build and strict typecheck pass.
- Hand off a published sample plan ID/date, ordered trip manifest and validation examples to Members 2-4. Supply API contract fixtures early; they can build against fixtures while this service is completed, but remove fixture-only behavior before demonstration.
