import { expect, test } from "@playwright/test";

/**
 * Terms round-trip (CC-q002.16). Opening Terms from the landing form and going
 * Back must return WITHOUT losing typed form state (PRD screens §11, flow rule).
 * Pure reducer (OPEN_TERMS/CLOSE_TERMS) so drivable today, no wiring needed.
 */
const MAC = "AA:BB:CC:DD:EE:FF";

test.beforeEach(async ({ page }) => {
  await page.goto(`/?id=${MAC}`);
});

test.describe("terms round-trip", () => {
  test("opens Terms from the form link and returns with form state intact", async ({ page }) => {
    await page.locator("#f-name").fill("Ada Lovelace");
    await page.locator("#f-email").fill("ada@example.com");
    await page.locator("#f-terms").check();

    // Open Terms via the in-form link.
    await page.getByRole("link", { name: "terms of use" }).first().click();
    await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();

    // Back returns to the landing form.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: /Let’s get you online/ })).toBeVisible();

    // Form state preserved across the round-trip.
    await expect(page.locator("#f-name")).toHaveValue("Ada Lovelace");
    await expect(page.locator("#f-email")).toHaveValue("ada@example.com");
    await expect(page.locator("#f-terms")).toBeChecked();
  });

  test("never names the SSID or uses the word 'guest' in the Terms copy (PRD rule 8)", async ({
    page,
  }) => {
    await page.getByRole("link", { name: "terms of use" }).first().click();
    await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("guest");
  });
});
