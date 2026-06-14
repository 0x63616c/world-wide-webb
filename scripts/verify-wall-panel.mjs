#!/usr/bin/env node
// Wall-panel verification harness (www-jtp0.7.10). Loads the LIVE Control Center
// private route at EXACTLY 1366x1024, asserts React mounted, no Cloudflare/origin
// error markers, no stuck-skeleton-only board, then writes a screenshot for human
// sign-off. The pure classification lives in scripts/panel-health.mjs (unit-tested
// without a browser); this driver just supplies the live DOM facts.
//
// The private route sits behind Cloudflare Access (kiosk service token), so when
// verifying app.cc directly you must pass the service-token headers, exactly as the
// iOS kiosk injects them:
//   CC_PANEL_URL=https://app.cc.worldwidewebb.co \
//   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... \
//   node scripts/verify-wall-panel.mjs
// (secrets come from 1Password; never hardcode. They are sent only as request
//  headers and never logged.)
//
// Requires Playwright chromium (already a dev dep; `bunx playwright install chromium`).
// Exits 0 only if the panel is healthy at the exact wall-panel geometry.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// chromium comes from the `playwright` dev dep in products/control-center/web;
// install the browser once with `bunx playwright install chromium`.
import { chromium } from "playwright";
import { classifyPanel, PANEL_HEIGHT, PANEL_WIDTH } from "./panel-health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = process.env.CC_PANEL_URL || "https://app.cc.worldwidewebb.co";
const OUT =
  process.env.CC_PANEL_SCREENSHOT || resolve(HERE, "../docs/screenshots/wall-panel-verify.png");
const CF_ID = process.env.CF_ACCESS_CLIENT_ID || "";
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || "";

async function main() {
  const browser = await chromium.launch();
  // Fixed wall-panel geometry, never responsive. deviceScaleFactor 1 so the
  // screenshot is a true 1366x1024 capture.
  const context = await browser.newContext({
    viewport: { width: PANEL_WIDTH, height: PANEL_HEIGHT },
    deviceScaleFactor: 1,
    ...(CF_ID && CF_SECRET
      ? { extraHTTPHeaders: { "CF-Access-Client-Id": CF_ID, "CF-Access-Client-Secret": CF_SECRET } }
      : {}),
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30_000 });
    // Give tiles a beat to resolve their first tRPC reads past the skeleton.
    await page.waitForTimeout(4_000);

    const facts = await page.evaluate(() => {
      const root = document.getElementById("root");
      // Skeletons use the shared Skeleton primitive; count shimmer placeholders vs
      // any rendered tile content so we can detect a stuck all-skeleton board.
      const skeletons = document.querySelectorAll(
        '[class*="skeleton" i],[data-skeleton],[class*="shimmer" i]',
      ).length;
      const content = root?.querySelectorAll("button, svg, [data-tile], h1, h2").length ?? 0;
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        html: document.documentElement.outerHTML,
        hasRoot: Boolean(root && root.children.length > 0),
        skeletonCount: skeletons,
        contentCount: content,
      };
    });

    const verdict = classifyPanel(facts);

    mkdirSync(dirname(OUT), { recursive: true });
    await page.screenshot({ path: OUT });
    console.log(`[verify-wall-panel] screenshot: ${OUT}`);
    console.log(
      `[verify-wall-panel] viewport: ${facts.width}x${facts.height} (want ${PANEL_WIDTH}x${PANEL_HEIGHT})`,
    );
    console.log(
      `[verify-wall-panel] root mounted: ${facts.hasRoot}, skeletons: ${facts.skeletonCount}, content: ${facts.contentCount}`,
    );

    if (!verdict.ok) {
      console.error("[verify-wall-panel] PANEL UNHEALTHY:");
      for (const r of verdict.reasons) console.error(`  - ${r}`);
      process.exitCode = 1;
      return;
    }
    console.log("[verify-wall-panel] PANEL HEALTHY at true wall-panel geometry.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[verify-wall-panel] error: ${err?.message ?? err}`);
  process.exitCode = 1;
});
