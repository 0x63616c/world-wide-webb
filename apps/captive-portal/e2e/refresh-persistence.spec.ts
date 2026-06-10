import { expect, test } from "@playwright/test";

/**
 * Mid-flow refresh persistence (CC-q002.16). The flow persists step+form to
 * sessionStorage keyed by MAC for the verify/password steps only, and restores
 * position on reload within the code TTL (CC-q002.7).
 *
 * Reaching verify/password NATURALLY needs the tRPC effect wiring (CC-q002.19),
 * so the natural-flow restore is tagged @needs-wiring. But the persistence
 * CONTRACT is drivable today by seeding the MAC-keyed key directly and proving
 * loadFlowState() rehydrates the app onto the verify screen on boot.
 */
const MAC = "AA:BB:CC:DD:EE:FF";
const KEY = `wwb-portal:${MAC}`;

test.describe("refresh persistence", () => {
  test("landing starts fresh on reload (no stale restore at landing)", async ({ page }) => {
    await page.goto(`/?id=${MAC}`);
    await page.locator("#f-name").fill("Ada Lovelace");
    await page.reload();
    // Landing is not a persisted step: the field resets, we are still on landing.
    await expect(page.getByRole("heading", { name: /Let’s get you online/ })).toBeVisible();
    await expect(page.locator("#f-name")).toHaveValue("");
  });

  test("a seeded verify position rehydrates onto the verify screen on boot", async ({ page }) => {
    // Prove the restore path (loadFlowState) against the real app without needing
    // the effect wiring: seed the exact persisted shape, then load.
    await page.addInitScript(
      ([key, payload]) => {
        window.sessionStorage.setItem(key, payload);
      },
      [
        KEY,
        JSON.stringify({
          step: "verify",
          form: { name: "Ada Lovelace", email: "ada@example.com", password: "", agreed: true },
          savedAt: Date.now(),
        }),
      ],
    );
    await page.goto(`/?id=${MAC}`);
    // Restored onto verify: the verify screen shows the destination email.
    await expect(page.getByText("ada@example.com")).toBeVisible();
  });

  test("a stale persisted position (older than the 10-min code TTL) is NOT restored", async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, payload]) => {
        window.sessionStorage.setItem(key, payload);
      },
      [
        KEY,
        JSON.stringify({
          step: "verify",
          form: { name: "Ada Lovelace", email: "ada@example.com", password: "", agreed: true },
          savedAt: Date.now() - 11 * 60 * 1000, // 11 min ago > 10-min TTL
        }),
      ],
    );
    await page.goto(`/?id=${MAC}`);
    // Stale → dropped back to a fresh landing, not verify.
    await expect(page.getByRole("heading", { name: /Let’s get you online/ })).toBeVisible();
  });

  test("@needs-wiring natural mid-flow refresh restores verify after a real sendCode", async ({
    page,
  }) => {
    // Once CC-q002.19 wires the tRPC client, drive Landing → sending → verify for
    // real, reload, and assert we land back on verify with the email intact.
    test.skip(true, "blocked on CC-q002.19 (tRPC client/effect-runner wiring)");
    await page.goto(`/?id=${MAC}`);
  });
});
