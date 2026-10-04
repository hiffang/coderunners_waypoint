import { expect, test } from "@playwright/test";
import { encode } from "next-auth/jwt";
import type { OrderDto } from "../../src/shared/dto/order";

// Run only against an isolated local server with this same test-only AUTH_SECRET.
// API fixtures exercise UI states; this suite does not claim database integration coverage.
const secret = process.env.STORE_UI_TEST_SECRET;
test.skip(!secret, "Requires an isolated server and STORE_UI_TEST_SECRET");
const id = "bdaf11e4-57af-42c7-b527-a4bbf4ca21a2";
const at = "2026-10-06T01:00:00.000Z";
const base: OrderDto = {
  id,
  orderRef: "ORD-TEST-001",
  outletId: "OUT001",
  outletLabel: "OUT001 · Fresh Colombo",
  district: "Colombo",
  depotId: "depot",
  brand: "FRESH",
  temp: "AMBIENT",
  requestedDate: "2026-10-06",
  eligibleServiceDate: "2026-10-06",
  submittedAt: "2026-10-04T09:00:00Z",
  status: "CONFIRMED",
  version: 1,
  totals: { units: 10, weightKg: 100, volumeM3: 0.4 },
  lines: [
    {
      id: "line",
      lineNo: 1,
      description: "Sealed milk crates",
      orderedUnits: 10,
      unitWeightKg: 10,
      unitVolumeM3: 0.04,
      loadedUnits: null,
      deliveredUnits: null,
      deliveryDamagedUnits: null,
      receivedUnits: null,
      receiptDamageUnits: null,
    },
  ],
  allocation: null,
  deferral: null,
  priorDeferrals: [],
  delivery: null,
  receipt: null,
  followUpOfId: null,
};

test.beforeEach(async ({ context, baseURL, page }) => {
  const cookie = "authjs.session-token";
  const token = await encode({
    secret: secret!,
    salt: cookie,
    token: {
      sub: "ui-test",
      uid: "ui-test",
      name: "Store UI Test",
      username: "store-test",
      role: "STORE",
      depotId: "depot",
      outletId: "OUT001",
      vehicleId: null,
    },
  });
  await context.addCookies([{ name: cookie, value: token, url: baseURL! }]);
  await page.route("**/api/shared/me", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          id: "ui-test",
          role: "STORE",
          outletId: "OUT001",
          timezone: "Asia/Colombo",
          serverTime: "2026-10-04T11:00:00Z",
          demoClock: false,
        },
      },
    }),
  );
  await page.route("**/api/shared/reference", (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          depots: [],
          vehicles: [],
          outlets: [
            {
              id: "OUT001",
              brand: "FRESH",
              district: "Colombo",
              depotId: "depot",
              depotName: "Peliyagoda",
            },
          ],
          cutoff: { localTime: "16:00", earliestEligibleDate: "2026-10-06" },
          calendar: [{ date: "2026-10-06", isOperating: true }],
        },
      },
    }),
  );
  await page.route("**/api/store/orders?*", (route) =>
    route.fulfill({
      json: { ok: true, data: { items: [base], nextCursor: null } },
    }),
  );
  await page.route(`**/api/store/orders/${id}`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: { order: base, editable: true, issues: [], serverTime: at },
      },
    }),
  );
  await page.route("**/api/store/issues", (route) =>
    route.fulfill({ json: { ok: true, data: [] } }),
  );
});

test("all store screens render without page overflow", async ({ page }) => {
  for (const [path, title] of [
    ["/store", "Orders"],
    ["/store/deliveries", "Deliveries"],
    ["/store/receipts", "Receipts"],
    ["/store/issues", "Issues"],
    ["/store/orders/new", "Create an order"],
    [`/store/orders/${id}`, "ORD-TEST-001"],
    [`/store/orders/${id}/edit`, "Edit order"],
    [`/store/orders/${id}/receipt`, "Confirm received goods"],
    [`/store/orders/${id}/issues`, "Report an issue"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test("order form preserves idempotency key across a failed retry and shows server acceptance", async ({
  page,
}) => {
  const requests: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/store/orders", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        json: {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message: "Temporary test connection failure",
          },
        },
      });
    else await route.fulfill({ json: { ok: true, data: base } });
  });
  await page.goto("/store/orders/new");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Sealed milk crates");
  await page.getByLabel("Units", { exact: true }).fill("10");
  await page.getByLabel("Weight / unit (kg)").fill("10");
  await page.getByLabel("Volume / unit (m³)").fill("0.04");
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary test connection failure" })).toContainText("not confirmed");
  await page.getByRole("button", { name: "Submit order", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/store/orders/${id}$`));
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1]).toEqual(requests[0]);
});

test("partial delivery opens a disputed receipt with actual quantities", async ({
  page,
}) => {
  const delivered: OrderDto = {
    ...base,
    status: "PARTIALLY_DELIVERED",
    lines: base.lines.map((l) => ({
      ...l,
      loadedUnits: 8,
      deliveredUnits: 8,
      deliveryDamagedUnits: 0,
    })),
    delivery: {
      stopId: "stop",
      stopState: "PARTIAL",
      arrivedAt: at,
      outcome: "PARTIAL",
      recipientName: "Manager",
      failureReason: "Two crates missing",
      submittedAt: at,
      evidence: [],
    },
  };
  let receiptBody:
    | { lines: Array<{ receivedUnits: number; damageUnits: number }> }
    | undefined;
  await page.route(`**/api/store/orders/${id}`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: { order: delivered, editable: false, issues: [], serverTime: at },
      },
    }),
  );
  await page.route(`**/api/store/orders/${id}/receipt`, async (route) => {
    receiptBody = route.request().postDataJSON();
    delivered.receipt = {
      id: "receipt",
      status: "DISPUTED",
      receivedAt: at,
      note: "One damaged crate",
      version: 1,
    };
    await route.fulfill({ json: { ok: true, data: delivered } });
  });
  await page.goto(`/store/orders/${id}/receipt`);
  await expect(page.getByLabel("Received units")).toHaveValue("8");
  await page.getByLabel("Damaged units").fill("1");
  await page
    .getByRole("button", { name: "Confirm receipt & report discrepancy" })
    .click();
  await expect(
    page.getByText("Your discrepancy has been sent to the dispatcher.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(receiptBody?.lines[0]).toMatchObject({
    receivedUnits: 8,
    damageUnits: 1,
  });
});
