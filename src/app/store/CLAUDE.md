# Member 4 - Store manager portal, orders and receipt

## Read first and scope
Read root CLAUDE.md and docs/TEAM_CONTRACT.md. Own `src/app/store/**`, `src/features/store/**`, `src/app/api/store/**` and store tests. Do not recreate shared Order/Receipt/Issue tables or auth. Explicitly read this file when editing API/features outside this directory. Coordinate line DTOs and receipt data with Members 1/3 before UI implementation.

## Outcome
An authorized store manager submits an order, knows the accepted delivery run, sees scheduled ETA or explained deferral, then confirms what actually arrived and reports discrepancies. Separate 'order accepted', 'allocated', 'driver delivered' and 'store received' visibly. Desktop and phone both work.

## Screens
1. `/store`: current orders, next expected arrival, pending receipts, deferral alert, server cutoff time. Display outlet/brand from account, not a selectable unauthorized store.
2. `/store/orders/new`: service date, ambient/chilled selection as permitted by brand, dynamic lines with description/units/weight/volume, server totals and explicit submit action. Catalog/product data is not supplied: free-text lines and measured totals are an MVP choice, not invented official SKUs. Seed realistic examples.
3. `/store/orders/[id]`: reference, accepted/eligible day, status timeline, line quantities, ETA (or 'Not scheduled'), latest refresh, deferral reason/next run and received summary.
4. `/store/orders/[id]/receipt`: compare ordered, loaded, delivered and received units; actual received/damaged entry, note and confirm/dispute. Show evidence from authorized API.
5. Issue report/history: order reference, discrepancy and severity, response/resolution visibility; don't hide the original delivery record when a dispute is raised.
6. Degradation screen: 'cutoff passed - next eligible run', deferral with reason and recovery, delivery not yet synchronized, or network submission error. Don't show 'confirmed' before server acknowledgement.

Follow submitted design, shared tokens and accessible form errors. Poll order detail while visible so Member 1 deferral or Member 3 delivery appears without full page reload. Include last refreshed timestamp. Do not show a fabricated map ETA.

## Ordering rules and backend
Implement Member 4 endpoints in TEAM_CONTRACT. Role/store scope is derived from User.outletId and actual Order.outletId; never trust submitted outletId/brand. Every order has a distinct UUID/orderRef; separate ambient/chilled orders for the same Fresh outlet/day are allowed. Idempotency prevents retries creating duplicate orders, not distinct intentional orders.

Server validates positive units, nonnegative measurements, at least one line and valid operating date. Units/weight/volume totals are calculated server-side. Chilled/frozen is only for permitted goods/brand; for this MVP Fresh supports ambient/chilled (frozen can be normalized as refrigeration-required if explicitly represented), Style/Tech ambient. Do not change imported vehicle/outlet data to accommodate an order.

Use server time and the Asia/Colombo calendar helper. Before 16:00 orders can enter the next operating day; at/after 16:00 the next day's queue has closed and the earliest eligible day is the following operating run. Examples assuming normal calendar: Friday 15:59 -> Saturday; Friday 16:00 -> Monday; Saturday 15:59 -> Monday; Saturday 16:00 -> Tuesday. Calendar overrides can change these; test actual supplied flags. Preserve the originally requested date separately from eligibleServiceDate, clearly show the adjustment, and do not backdate from device timestamps.

The team choice is to allow advance-dated requests beyond the earliest eligible day. Reject dates before earliest eligibility or normalize with explicit confirmation per submitted design. Fresh daily ordering, Style weekly scheduling and Tech as-needed should be reflected in defaults and validation. If no official Style outlet schedule is supplied, use an explicitly configured seeded schedule; don't invent imported schedule fields. Prevent silent scheduling to non-operating days.

Edits/cancel require ownership, expectedVersion, before cutoff for target service day and no published allocation. Do not mutate order lines already snapshotted for loading. Coordinate with dispatcher transaction guards so publish racing an edit cannot produce a stale manifest. Draft UI can exist client-side but server confirmation must be real.

## Tracking and receipt
Read allocation and deferral from Member 1's shared models. Deferred displays reason, previous missed runs if supplied and next eligible run; ETA remains absent until served allocation exists. Receipt isn't enabled until the server has a delivered/partially_delivered outcome. An offline driver's pending outcome is not server-confirmed arrival.

For receipt, validate each line belongs to this order and received units are within the actual delivered quantities. Damage <= received units. Use exactly one Receipt per order and idempotent submission. A discrepancy creates Receipt.disputed and a linked Issue; a clean acknowledgement creates confirmed receipt and Order.received. Do not replace partial delivery history with a pretend full delivery. Store cannot write ProofOfDelivery or Trip state. Later dispute updates must be auditable and coordinated rather than overwriting the initial receipt.

MVP receipts/submissions require online acknowledgement. Optionally use Member 3's shared outbox for store drafts/receipt commands after the required flow passes; offline orders still use server acceptance time on replay and may miss cutoff. Do not build a separate offline database or silently call a locally saved draft a confirmed order.

## Phased implementation
A. Real list/detail, order form, server cutoff/calendar helper behavior and distinct dry/chilled orders.
B. Allocation/ETA and explicit deferral visibility from shared plan data.
C. Actual receipt quantities, discrepancy Issue and delivery evidence.
D. Cutoff/network failure recovery, phone UX and design comparison.

## Acceptance and handoff
- Wrong-outlet read/write attempts fail server-side; no client-supplied brand/outlet override.
- Test exactly 16:00, Sri Lanka versus UTC dates, Friday/Saturday/Sunday and supplied calendar exceptions.
- Two same-outlet/day dry/chilled orders are distinct; retry same submit key creates only one.
- Already allocated or cutoff-locked orders cannot be edited/cancelled, including publication race.
- Member 1 sees submitted eligible order; store sees its deferral or allocation and honest ETA.
- Before driver sync, receipt blocked; after sync, actual delivered line quantities/evidence visible.
- Receipt retry creates one receipt; discrepancy creates visible dispatcher Issue and preserves proof; cross-outlet receipt rejected.
- Run relevant tests, strict typecheck/build and phone QA. Hand off order IDs, cutoff examples and receipt walkthrough to lead.
