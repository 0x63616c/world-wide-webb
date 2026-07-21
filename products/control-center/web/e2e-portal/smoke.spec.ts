import { expect, test } from "@playwright/test";

/**
 * Smoke spec (SDD track 0, task 2.6). Proves the harness wiring (dev server,
 * chromium, base URL) end-to-end and locks in the three invariants that must
 * hold across every screen the guest bundle renders:
 *  - the app boots and React mounts (the WifiPassword entry screen's h1),
 *  - the page background is pure black (#000, Calum's hard rule), and
 *  - the bundle is entirely self-hosted (no CDN requests) — captive webviews
 *    (Apple CNA) block network access to anything but the portal's own host.
 *
 * A mac param is passed so the app runs its real boot path (status query)
 * rather than the mac-less no-op branch — this is the "normal" case a real
 * UniFi redirect produces.
 */
const MAC = "aa:bb:cc:dd:ee:ff";

test.describe("guest portal smoke", () => {
  test("boots and renders the entry screen heading", async ({ page }) => {
    await page.goto(`/portal.html?mac=${MAC}`);
    await expect(page.getByRole("heading", { name: "Enter the Wi-Fi password" })).toBeVisible();
  });

  test("page background is pure black (#000)", async ({ page }) => {
    await page.goto(`/portal.html?mac=${MAC}`);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const channels = bg.match(/[\d.]+/g)?.map(Number) ?? [];
    expect(channels.slice(0, 3)).toEqual([0, 0, 0]);
    // body bg must be opaque (alpha 1, or no alpha channel). A transparent
    // body would mean the black is coming from somewhere unguaranteed.
    if (channels.length === 4) expect(channels[3]).toBe(1);
  });

  test("issues zero non-localhost network requests (self-hosted fonts + assets proof)", async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        !url.startsWith("http://127.0.0.1") &&
        !url.startsWith("http://localhost") &&
        !url.startsWith("data:")
      ) {
        external.push(url);
      }
    });
    await page.goto(`/portal.html?mac=${MAC}`, { waitUntil: "networkidle" });
    expect(external).toEqual([]);
  });
});
