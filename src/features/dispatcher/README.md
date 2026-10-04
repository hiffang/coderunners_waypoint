# Dispatcher portal

The dispatcher pages and `/api/dispatcher/*` endpoints use the existing depot scope, shared DTOs, audit log and serializable mutation helper. No schema or other portal changes are required.

## Walkthrough

1. Sign in as `dispatcher` and select service date `2026-09-26` to inspect the seeded overloaded queue. `/dispatcher/orders` filters by brand, temperature, district, access, order and outlet.
2. Create the date's plan from Overview or Routes. Click an order to choose a vehicle, trip number and stop position, then **Apply to draft**. **Save draft** validates assignments. Unassigned orders may remain in a draft.
3. Alternatively, **Auto-allocate queue** builds a deterministic feasible candidate with explicit deferrals. It is a greedy convenience, not a globally optimal solution. Refrigerated/van-only capability tiers come first, then prior distinct missed runs, closing time and stable ID. Ambient orders prefer dry vehicles.
4. **Validate plan** checks the current queue, driver/vehicle availability, capacities, windows, daily trip slots and weekly fuel on the server. **Publish plan** is enabled only after the current saved version passes. The server repeats validation transactionally before publishing. Publication waits until the queue's preceding operating-day 16:00 cutoff.
5. Published manifests appear in the loader portal. Store order DTOs expose deferral reasons and next eligible dates. Monitor and Loading bays poll every ten seconds; driver proof and store receipt remain separate.
6. Before departure, changing assignments via **Save & republish revision** replaces reserved fuel, increments revision, preserves trip IDs where possible and resets loading checks/readiness. A plan with any departed trip is locked; coordinate through issues instead.
7. Acknowledge or resolve issues in Monitor. Resolving blocking stock issues requires corrected, complete, undamaged checks for the current revision. A fully failed delivery can be requeued from Deferrals, with its original evidence preserved and a recovery issue/audit event. Partial deliveries require the store to place a replacement order.

The existing published seed plan on `2026-09-25` is available for inspecting loading issues and historical deferrals without publishing new demo data.

## Travel estimates and MVP policies

Distances are explicitly configured estimates because no route-distance dataset was supplied. One-way depot-to-district estimates in km:

| Depot | District estimates |
| --- | --- |
| Peliyagoda | Colombo 15, Gampaha 30, Kalutara 55, Galle 120, Matara 160, Kurunegala 85, Puttalam 130 |
| Kandy | Kandy 15, Matale 30, Nuwara Eliya 75, Badulla 115, Kegalle 45 |

Scheduling starts at 04:00, assumes 30 km/h, 5 km between distinct stops, 15 minutes handling per stop and 30 minutes reload. Early arrival waits for opening. Arrivals must meet outlet and mall windows; Fresh arrives strictly before 08:00. Handling may finish after closing. Return travel is included; trip two starts after the first return and reload. Estimates are shown in the UI and missing districts fail visibly.

Whole orders, single-brand/single-district trips, at most two trips per vehicle/day, no cross-depot borrowing, and locking the entire plan after any departure are deliberate MVP policies. This is not the Datathon Task 2B engine. Fuel is conservatively rounded up to 0.01 L per trip; capacity comparisons use a 0.000001 tolerance without UI rounding affecting acceptance. Draft trips hold the schema's unique vehicle/date/trip slot but do not reserve fuel.

Manual edits to published plans revalidate and republish atomically; they are not saved as a separate draft revision. All loading checks in that plan are invalidated, including unchanged trips. Plans with unresolved issues cannot remove the affected trip. No fleet overflow procurement or predictive forecasting is implemented; Fleet and Reports use actual stored records and explicitly labeled route estimates.

## Verification

```text
npm run typecheck
npm run lint
npm run build
npm test
npx vitest run --project integration tests/integration/dispatcher.test.ts --hookTimeout 30000
npx playwright test tests/e2e/dispatcher.spec.ts --workers=1
```

Integration tests require the local seeded database and create/clean their own historical test plans, orders, issues and fuel ledgers. Browser tests use the seeded accounts and read the supplied sample days. Set `E2E_BASE_URL` when the server runs on a port other than 3000.
