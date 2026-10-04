import "dotenv/config";
import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

/** Fixture via tsx (the generated Prisma client is ESM-only); assertions in plain SQL. */
function readyTrip(username = "driver") {
  const out = execSync(`npx tsx tests/e2e/driver-fixture-cli.ts ${username}`, { encoding: "utf8" });
  const { tripId, stopIds } = JSON.parse(out.trim().split(/\r?\n/).pop()!) as { tripId: string; vehicleId: string; stopIds: string[] };
  return { trip: { id: tripId }, stops: stopIds.map((id) => ({ id })) };
}

async function sql<T>(text: string, params: unknown[]): Promise<T[]> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}
const proofs = async (stopId: string) => Number((await sql<{ n: string }>(`select count(*) n from "ProofOfDelivery" where "stopId" = $1`, [stopId]))[0].n);
const outcomeAudits = async (stopId: string) =>
  Number((await sql<{ n: string }>(`select count(*) n from "AuditLog" where "entityId" = $1 and action = 'stop.outcome'`, [stopId]))[0].n);
const stopState = async (stopId: string) => (await sql<{ state: string }>(`select state from "Stop" where id = $1`, [stopId]))[0].state;

// Production build only (service worker), phone size, real offline reload.
const password = process.env.DEMO_PASSWORD ?? "Waypoint#2026";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.skip(({ isMobile }) => !isMobile, "driver offline journey runs at phone size");
test.describe.configure({ mode: "serial" });

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/driver$/);
}

test("download, depart, deliver offline with photo, reload offline, sync once after a lost response", async ({ page, context }) => {
  const { trip, stops } = readyTrip();

  await login(page, "driver");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByTestId("download-offline").click();
  await expect(page.getByText(/saved for offline use/)).toBeVisible({ timeout: 30_000 });

  // Online departure (server validates the warehouse release).
  await page.goto(`/driver/trips/${trip.id}`);
  await page.getByTestId("depart").click();
  await expect(page.getByText("Departure confirmed by the server")).toBeVisible();
  await expect(page.getByTestId("depart")).toHaveCount(0);

  // Connection drops. Navigation falls back to the cached shell under the same URL.
  await context.setOffline(true);
  await page.getByTestId("stop-card").first().click();
  await expect(page).toHaveURL(new RegExp(`/driver/stops/${stops[0].id}$`));
  await expect(page.getByTestId("driver-shell")).toBeVisible();

  await page.getByTestId("arrive").click();
  await expect(page.getByTestId("outcome-form")).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles({ name: "pod.png", mimeType: "image/png", buffer: PNG_1PX });
  await expect(page.getByAltText("Evidence preview")).toBeVisible();
  await page.getByLabel("Recipient name").fill("Nimal Perera");
  await page.getByTestId("submit-outcome").click();
  await expect(page.getByTestId("outcome-summary")).toBeVisible();
  await expect(page.getByText("Saved on phone · not sent yet").first()).toBeVisible();

  // Full browser reload while offline: shell + IndexedDB, nothing lost.
  await page.reload();
  await expect(page.getByTestId("driver-shell")).toBeVisible();
  await expect(page.getByTestId("outcome-summary")).toBeVisible();
  await expect(page.getByTestId("local-photos").locator("img")).toHaveCount(1);
  expect(await proofs(stops[0].id)).toBe(0);

  // Reconnect, but lose the outcome response after the server committed it.
  let dropped = 0;
  await page.route("**/api/driver/stops/*/outcome", async (route) => {
    if (dropped === 0) {
      dropped++;
      await route.fetch(); // reaches the server and commits
      await route.abort("connectionreset"); // the phone never hears back
      return;
    }
    await route.continue();
  });
  await context.setOffline(false);
  await page.goto("/driver/sync");
  await expect.poll(() => dropped, { timeout: 30_000 }).toBe(1);
  expect(await proofs(stops[0].id)).toBe(1);

  // Retry with the same Idempotency-Key and frozen body: still exactly one proof.
  await page.getByTestId("sync-now").click();
  await expect(page.getByText("Everything you recorded has been confirmed by the server.")).toBeVisible({ timeout: 30_000 });
  expect(await proofs(stops[0].id)).toBe(1);
  expect(await outcomeAudits(stops[0].id)).toBe(1);
  const [proof] = await sql<{ outcome: string; recipientName: string; files: string }>(
    `select p.outcome, p."recipientName", (select count(*) from "Attachment" a where a."proofId" = p.id and a."linkedAt" is not null) files
       from "ProofOfDelivery" p where p."stopId" = $1`,
    [stops[0].id],
  );
  expect(proof).toMatchObject({ outcome: "DELIVERED", recipientName: "Nimal Perera", files: "1" });
  expect(await stopState(stops[0].id)).toBe("DELIVERED");
});

test("another account on the same phone never sends or sees the first driver's work", async ({ page, context }) => {
  const { trip, stops } = readyTrip();

  await login(page, "driver");
  await page.getByTestId("download-offline").click();
  await expect(page.getByText(/saved for offline use/)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/driver/trips/${trip.id}`);
  await page.getByTestId("depart").click();
  await expect(page.getByText("Departure confirmed by the server")).toBeVisible();

  await context.setOffline(true);
  await page.getByTestId("stop-card").first().click();
  await page.getByTestId("arrive").click();
  await expect(page.getByTestId("outcome-form")).toBeVisible();

  // Someone else signs in on this phone before the arrival was sent.
  await context.clearCookies();
  await context.setOffline(false);
  await login(page, "driver-veh036");
  await expect(page.getByTestId("trip-card").filter({ hasText: "VEH035" })).toHaveCount(0);
  await page.goto("/driver/sync");
  await expect(page.getByText(/Dinesh Fernando has 1 unsent action/)).toBeVisible();
  await expect(page.getByTestId("event-card")).toHaveCount(0);
  expect(await stopState(stops[0].id)).toBe("PENDING");

  // The original driver signs back in: their queue resumes.
  await context.clearCookies();
  await login(page, "driver");
  await page.goto("/driver/sync");
  await expect(page.getByText("Everything you recorded has been confirmed by the server.")).toBeVisible({ timeout: 30_000 });
  expect(await stopState(stops[0].id)).toBe("ARRIVED");
});
