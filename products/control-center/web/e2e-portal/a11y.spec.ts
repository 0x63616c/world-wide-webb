import { expect, test } from "@playwright/test";

/**
 * Accessibility invariants on WifiPassword, the sole entry screen of the
 * password-only guest portal (SDD track 0, task 2.6). Drivable today: no
 * server wiring needed, just the rendered DOM.
 */
const MAC = "aa:bb:cc:dd:ee:ff";

test.beforeEach(async ({ page }) => {
  await page.goto(`/portal.html?mac=${MAC}`);
});

test.describe("WifiPassword a11y", () => {
  test("the password field has an associated label (label htmlFor -> input id)", async ({
    page,
  }) => {
    // Field renders <label htmlFor="w-pass"> / <input id="w-pass">;
    // getByLabel resolves it structurally, not by placeholder text.
    await expect(page.getByLabel("Wi-Fi password")).toBeVisible();
    await expect(page.locator("#w-pass")).toHaveAttribute("id", "w-pass");
  });

  test("a password field error is wired via aria-describedby to the Field error slot", async ({
    page,
  }) => {
    // Submitting a too-short password (button enabled: non-empty + terms
    // agreed) surfaces the synchronous validate.ts error inline.
    await page.locator("#w-pass").fill("abc");
    await page.locator("#w-terms").check();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();

    const input = page.locator("#w-pass");
    await expect(input).toHaveAttribute("aria-describedby", "w-pass-error");
    const errorEl = page.locator("#w-pass-error");
    await expect(errorEl).toHaveAttribute("role", "alert");
    await expect(errorEl).toHaveText("That password looks too short.");
  });

  test("the terms checkbox is reachable and toggleable by keyboard", async ({ page }) => {
    await page.locator("#w-terms").focus();
    await expect(page.locator("#w-terms")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("#w-terms")).toBeChecked();
    await page.keyboard.press("Space");
    await expect(page.locator("#w-terms")).not.toBeChecked();
  });

  test("keyboard-only: tab from password straight to the terms checkbox", async ({ page }) => {
    // The show/hide toggle is deliberately `tabIndex={-1}` (WifiPassword.tsx)
    // to keep the tab order tight (password -> terms -> submit); verified
    // against the running app, not assumed.
    await page.locator("#w-pass").focus();
    await page.keyboard.type("hunter2!");
    await page.keyboard.press("Tab");
    await expect(page.locator("#w-terms")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("#w-terms")).toBeChecked();
  });
});
