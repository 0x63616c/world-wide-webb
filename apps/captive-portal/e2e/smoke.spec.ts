import { expect, test } from "@playwright/test";

/**
 * Smoke spec (CC-q002.16, PREP). Drives the CURRENT placeholder app, proves the
 * harness wiring (dev server, chromium, base URL) end-to-end and locks in three
 * invariants that must hold for every screen the flow milestones add later:
 *  - the app boots and React mounts,
 *  - the page background is pure black (#000, Calum's hard rule), and
 *  - Geist is self-hosted (captive webviews block CDNs, PRD Frontend rule 3).
 * The full journey matrix (happy path, validation, lockouts, resend, refresh,
 * already-online, Terms, mobile, keyboard) lands once CC-q002.6/.7 exist.
 */
test.describe("captive portal smoke (placeholder app)", () => {
  test("boots and renders the shell heading", async ({ page }) => {
    await page.goto("/");
    // The placeholder renders this; the flow milestones replace it with the
    // Landing screen, at which point this assertion updates to the real heading.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("page background is pure black (#000)", async ({ page }) => {
    await page.goto("/");
    // The base background lives on html/body (theme.css sets --background:#000
    // there); .wwb-stage is transparent and lets it show through. Assert the
    // page's actual painted base is pure, opaque black.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const channels = bg.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(channels.slice(0, 3)).toEqual([0, 0, 0]);
    // body bg must be opaque (alpha 1, or no alpha channel). A transparent body
    // would mean the black is coming from somewhere unguaranteed.
    if (channels.length === 4) expect(channels[3]).toBe(1);
  });

  test("self-hosts Geist (no CDN font requests)", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        req.resourceType() === "font" &&
        !url.startsWith("http://127.0.0.1") &&
        !url.startsWith("http://localhost")
      ) {
        external.push(url);
      }
    });
    await page.goto("/", { waitUntil: "networkidle" });
    expect(external).toEqual([]);
  });
});
