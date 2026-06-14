import { expect, test } from "@playwright/test";

/**
 * Landing validation matrix (www-q002.16). These four errors are produced
 * SYNCHRONOUSLY by the pure reducer on submit (no server effect), so they are
 * fully drivable against the real app today, before the tRPC client wiring
 * (www-q002.19) lands. Messages are asserted verbatim from validate.ts.
 *
 * Flow rule (PRD 1): validate on submit; a field error clears on first edit of
 * that field.
 */
const MAC = "AA:BB:CC:DD:EE:FF";

test.beforeEach(async ({ page }) => {
  await page.goto(`/?id=${MAC}`);
});

async function submit(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
}

test.describe("landing validation", () => {
  test("name required", async ({ page }) => {
    await page.locator("#f-email").fill("ada@example.com");
    await page.locator("#f-terms").check();
    await submit(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "Please enter your name." }),
    ).toBeVisible();
  });

  test("email required", async ({ page }) => {
    await page.locator("#f-name").fill("Ada Lovelace");
    await page.locator("#f-terms").check();
    await submit(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "Email is required to connect." }),
    ).toBeVisible();
  });

  test("email format", async ({ page }) => {
    await page.locator("#f-name").fill("Ada Lovelace");
    await page.locator("#f-email").fill("not-an-email");
    await page.locator("#f-terms").check();
    await submit(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "That doesn’t look like a valid email address." }),
    ).toBeVisible();
  });

  test("terms unticked", async ({ page }) => {
    await page.locator("#f-name").fill("Ada Lovelace");
    await page.locator("#f-email").fill("ada@example.com");
    await submit(page);
    await expect(page.getByRole("alert").filter({ hasText: "You must accept" })).toBeVisible();
  });

  test("a field error clears on first edit of that field (PRD flow rule 1)", async ({ page }) => {
    await submit(page); // all empty → name + email + terms errors
    const nameErr = page.getByRole("alert").filter({ hasText: "Please enter your name." });
    await expect(nameErr).toBeVisible();
    await page.locator("#f-name").fill("A");
    await expect(nameErr).toHaveCount(0);
  });

  test("stays on the landing step while invalid (no transition to sending)", async ({ page }) => {
    await submit(page);
    // The heading is still the landing heading; we did not advance.
    await expect(page.getByRole("heading", { name: /Let’s get you online/ })).toBeVisible();
  });
});
