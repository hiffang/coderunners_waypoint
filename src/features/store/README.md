# Store portal

Implemented routes: `/store`, `/store/deliveries`, `/store/receipts`, `/store/issues`,
`/store/orders/new`, `/store/orders/[id]`, and the order's `/edit`, `/receipt`, `/issues` pages.

The store API now implements the shared order contract, scoped to the signed-in outlet.
GET order detail returns `{ order: OrderDto, editable, issues: IssueDto[], serverTime }`
inside the standard `ok/data` envelope. GET `/api/store/issues` returns authorized order
issues and dispatcher responses. Lists use chronological cursor pagination.

All submissions require an idempotency key. Ambiguous client retries retain their key,
original payload, and original version. Server writes use the shared serializable
transaction/audit helper. Edits and cancellation are locked at the previous operating
run's 16:00 cutoff, after publication, or once the order appears on a manifest.

Dates before current server eligibility are rejected with the next eligible date;
the store must explicitly choose that date or a later operating day. Invalid calendar
and non-operating dates are rejected. Fresh supports separate ambient/chilled orders.
Style and Tech support ambient orders. Style's weekly cadence is explained in the form,
but an outlet-specific weekly schedule is not enforced because none was supplied or
configured in the shared foundation. This remains a scheduling handoff to the lead.

Receipts require a server-synchronized delivery, exactly one entry per order line,
received quantities no greater than delivered quantities, and damage no greater than
received. Shortfalls, damage, and partial deliveries create a disputed receipt and
an issue while preserving the driver record and partial order state. Clean receipts
mark the order received. Uploaded attachment IDs are ownership-checked and linked
transactionally when supplied. The UI displays driver evidence; receipt/issue file
upload controls are not part of this implementation.

Orders and receipts require online acknowledgement. This portal does not queue store
writes offline. Detail polling runs every 10 seconds while visible; list/issues every
15 seconds and cutoff/reference every 30 seconds. Network errors remain visible and
do not claim server confirmation.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test` (store authorization, cutoff, receipt quantities and transaction effects)
- `npm run build -- --webpack` (the sandbox blocked Turbopack's worker port)

Isolated UI tests use fixtures and a temporary JWT signed with an explicitly supplied
test secret; they do not bypass authentication in application code or test the database.
Start a local production server with the same secret and URL, then run:

```sh
AUTH_SECRET=local-store-ui-test-only AUTH_URL=http://localhost:3107 npm run start -- --port 3107
E2E_BASE_URL=http://localhost:3107 STORE_UI_TEST_SECRET=local-store-ui-test-only npx playwright test tests/e2e/store-ui.spec.ts
```

The UI suite checks every route at desktop/phone sizes, failed submission retries and
partial-delivery disputes. Without `STORE_UI_TEST_SECRET` these isolated tests are
skipped. Live DB integration was not run because local Docker was stopped and no
DATABASE_URL was configured. Use the seeded stack for the real store → dispatcher →
loader → driver → receipt handoff, including concurrent publication and idempotent
receipt replay against PostgreSQL.
