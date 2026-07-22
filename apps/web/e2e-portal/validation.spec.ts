import { expect, test } from "@playwright/test";

/**
 * WifiPassword validation matrix (SDD track 0, task 2.6). Password-only entry
 * screen (no name/email); the two guards are the password format and the
 * terms checkbox. Both are synchronous — drivable against the real app,
 * no server wiring needed.
 *
 * Note on shape: unlike the old name/email landing form (which let you submit
 * with a client-side error), WifiPassword.tsx GATES the Connect button
 * (`disabled={!pw || !agreed}`, App.tsx) rather than rendering an error for
 * an empty password or unticked terms on submit. These specs assert the real
 * gating behavior, then exercise the one inline error validate.ts DOES
 * produce (a too-short-but-non-empty password) to prove the Field/error-slot
 * wiring end to end.
 */
const MAC = "aa:bb:cc:dd:ee:ff";

test.beforeEach(async ({ page }) => {
  await page.goto(`/portal.html?mac=${MAC}`);
});

test.describe("WifiPassword validation", () => {
  test("empty password: Connect stays disabled even with terms agreed", async ({ page }) => {
    await page.locator("#w-terms").check();
    await expect(page.getByRole("button", { name: "Connect to Wi-Fi" })).toBeDisabled();
  });

  test("unchecked terms: Connect stays disabled even with a password entered", async ({ page }) => {
    await page.locator("#w-pass").fill("hunter2!");
    await expect(page.locator("#w-terms")).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Connect to Wi-Fi" })).toBeDisabled();
  });

  test("a too-short password submits and shows the inline validate.ts error", async ({ page }) => {
    await page.locator("#w-pass").fill("abc");
    await page.locator("#w-terms").check();
    await expect(page.getByRole("button", { name: "Connect to Wi-Fi" })).toBeEnabled();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.locator("#w-pass-error")).toHaveText("That password looks too short.");
    // Stays on the password screen (no server round-trip for a format error).
    await expect(page.getByRole("heading", { name: "Enter the Wi-Fi password" })).toBeVisible();
  });

  test("the inline error clears on the next submit, not on keystroke (verified against the running app)", async ({
    page,
  }) => {
    // Unlike the old name/email landing form (which dispatched EDIT_FIELD -
    // and so cleared its error - on every keystroke), WifiPassword.tsx keeps
    // the password in local useState and only reaches the reducer on submit;
    // typing after a failed submit does NOT clear the inline error until the
    // guest submits again.
    await page.locator("#w-pass").fill("abc");
    await page.locator("#w-terms").check();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.locator("#w-pass-error")).toHaveText("That password looks too short.");
    await page.locator("#w-pass").type("!!!!");
    await expect(page.locator("#w-pass-error")).toHaveText("That password looks too short.");
    // Now long enough (7 chars) to pass the format check; the reducer clears
    // passwordError synchronously on a validating submit, before the (here
    // unmocked, and irrelevant to this assertion) network round-trip settles.
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.locator("#w-pass-error")).toBeEmpty();
  });
});
