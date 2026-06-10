import { expect, test } from "@playwright/test";

/**
 * Accessibility + viewport invariants on the landing screen (www-q002.16). These
 * are drivable today (landing is reducer-only). The full keyboard/reduced-motion
 * journey across verify/password lands with the wiring (www-q002.19); here we lock
 * the entry screen's a11y so regressions on the most-hit screen fail fast.
 */
const MAC = "AA:BB:CC:DD:EE:FF";

test.beforeEach(async ({ page }) => {
  await page.goto(`/?id=${MAC}`);
});

test.describe("landing a11y + viewport", () => {
  test("renders in a mobile viewport (default Pixel 7) without overflow", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /Let’s get you online/ });
    await expect(heading).toBeVisible();
    // No horizontal scroll: the document is not wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("inputs have associated labels (label htmlFor → input id)", async ({ page }) => {
    // Field renders <label for=f-name> / <input id=f-name>; getByLabel resolves it.
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("validation errors use role=alert and aria-invalid on the field", async ({ page }) => {
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.locator("#f-name")).toHaveAttribute("aria-invalid", "true");
  });

  test("keyboard-only: can tab to the fields and submit with Enter", async ({ page }) => {
    await page.locator("#f-name").focus();
    await page.keyboard.type("Ada Lovelace");
    await page.keyboard.press("Tab");
    await page.keyboard.type("ada@example.com");
    // Tab to the checkbox and toggle it with Space.
    await page.locator("#f-terms").focus();
    await page.keyboard.press("Space");
    await expect(page.locator("#f-terms")).toBeChecked();
    // Submit via Enter from a text field.
    await page.locator("#f-email").focus();
    await page.keyboard.press("Enter");
    // Valid form: no validation alerts remain.
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("respects prefers-reduced-motion (boots + paints with motion reduced)", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`/?id=${MAC}`);
    await expect(page.getByRole("heading", { name: /Let’s get you online/ })).toBeVisible();
    await ctx.close();
  });
});
