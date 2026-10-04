import { expect, test } from "@playwright/test";

const password = process.env.DEMO_PASSWORD ?? "Waypoint#2026";

for (const [username, home] of [
  ["dispatcher", "/dispatcher"],
  ["loader", "/loader"],
  ["driver", "/driver"],
  ["store", "/store"],
] as const) {
  test(`${username} signs in and lands on ${home}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));
  });
}
