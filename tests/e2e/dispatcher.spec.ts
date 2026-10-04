import { expect, test } from "@playwright/test";
test.setTimeout(90000);
test.use({ reducedMotion: "reduce" });

test("dispatcher navigation, queue filters and responsive layout", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "phone")
    await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await page.getByLabel("Username").fill("dispatcher");
  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "Waypoint#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dispatcher$/);
  await expect(
    page.getByRole("heading", { name: "Your depot, at a glance." }),
  ).toBeVisible();
  await expect(page.getByText(/Last refreshed/)).toBeVisible({
    timeout: 20000,
  });
  await page.screenshot({
    path: testInfo.outputPath("dispatcher-overview.png"),
    fullPage: true,
  });
  for (const [path, heading] of [
    ["orders", "Order queue"],
    ["routes", "Route planning"],
    ["deferrals", "Every missed run, explained."],
    ["loading-bays", "Loading bays"],
    ["monitor", "Delivery monitor"],
    ["reports", "Service report"],
    ["fleet", "Fleet & capacity"],
  ]) {
    await page.goto(`/dispatcher/${path}?serviceDate=2026-09-26`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Last refreshed/)).toBeVisible({
      timeout: 20000,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/dispatcher/orders?serviceDate=2026-09-26");
  await expect(page.getByText(/Last refreshed/)).toBeVisible({
    timeout: 20000,
  });
  await page.getByLabel("Find an order").fill("does-not-exist");
  await expect(page.getByText("No orders match these filters.")).toBeVisible();
  await page.getByLabel("Find an order").fill("");
  await page
    .getByRole("combobox", { name: "Temperature", exact: true })
    .selectOption("CHILLED");
  await page.screenshot({
    path: testInfo.outputPath("dispatcher-orders.png"),
    fullPage: true,
  });
  const plans = await (
    await page.request.get("/api/dispatcher/plans?serviceDate=2026-09-25")
  ).json();
  expect(plans.data.items.length).toBeGreaterThan(0);
  await page.goto(`/dispatcher/plans/${plans.data.items[0].id}`);
  await expect(
    page.getByRole("heading", { name: "Route planning", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("heading", { name: "Orders to plan" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("dispatcher-planner.png"),
    fullPage: true,
  });
  if (testInfo.project.name === "desktop") {
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("dispatcher APIs require authentication and reject cross-origin writes", async ({
  request,
  page,
}) => {
  expect((await request.get("/api/dispatcher/orders")).status()).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Username").fill("store");
  await page
    .getByLabel("Password")
    .fill(process.env.DEMO_PASSWORD ?? "Waypoint#2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/store$/);
  expect((await page.request.get("/api/dispatcher/orders")).status()).toBe(403);
  expect(
    (
      await page.request.post("/api/dispatcher/plans", {
        headers: { origin: "https://untrusted.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
});
