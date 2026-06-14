// Wall-panel health classification (www-jtp0.7.10), UI-free and pure so it can be
// unit-tested without a browser. Mirrors the iOS KioskHealth.swift markers so the
// web verification and the native watchdog agree on what "broken panel" means.
//
// classifyPanel({ width, height, html, hasRoot }) -> { ok, reasons[] }
//   ok=true only when the viewport is EXACTLY the wall-panel size, the React #root
//   is present, and the document shows no Cloudflare/origin error markers and no
//   stuck-skeleton-only state.

export const PANEL_WIDTH = 1366;
export const PANEL_HEIGHT = 1024;

// Same CF error markers the iOS watchdog scans for (KioskHealth.swift). Lowercased
// substring match against the live document text.
export const CLOUDFLARE_MARKERS = [
  "cf-error-details",
  "cf-error-code",
  "cf-wrapper",
  "error 1033",
  "error 520",
  "error 521",
  "error 522",
  "error 523",
  "error 524",
  "error 525",
  "error 526",
  "error 530",
];

/**
 * @param {{ width:number, height:number, html:string, hasRoot:boolean,
 *           skeletonCount?:number, contentCount?:number }} input
 * @returns {{ ok:boolean, reasons:string[] }}
 */
export function classifyPanel(input) {
  const reasons = [];
  const { width, height, html, hasRoot } = input;

  if (width !== PANEL_WIDTH || height !== PANEL_HEIGHT) {
    reasons.push(`viewport ${width}x${height} != ${PANEL_WIDTH}x${PANEL_HEIGHT}`);
  }
  if (!hasRoot) {
    reasons.push("React #root element missing (page did not mount)");
  }

  const lower = (html ?? "").toLowerCase();
  for (const marker of CLOUDFLARE_MARKERS) {
    if (lower.includes(marker)) {
      reasons.push(`cloudflare/origin error marker present: "${marker}"`);
      break; // one is enough; don't spam every variant
    }
  }

  // Stuck-skeleton detection: tiles show a Skeleton while loading and recover on
  // their own, so skeletons alone are fine. But a panel that is ONLY skeletons
  // with zero rendered content is a stuck/empty board, flag it.
  const skeletonCount = input.skeletonCount ?? 0;
  const contentCount = input.contentCount ?? 0;
  if (skeletonCount > 0 && contentCount === 0) {
    reasons.push(`panel shows only skeletons (${skeletonCount}) with no rendered content`);
  }

  return { ok: reasons.length === 0, reasons };
}
