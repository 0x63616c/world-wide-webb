// Hermetic tests for scripts/panel-health.mjs (www-jtp0.7.10). Pure logic, no
// browser. Run via: node scripts/test-panel-health.mjs
import assert from "node:assert/strict";
import { classifyPanel, PANEL_HEIGHT, PANEL_WIDTH } from "./panel-health.mjs";

let pass = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

const healthy = {
  width: PANEL_WIDTH,
  height: PANEL_HEIGHT,
  html: "<html><body><div id=root><button>Lights</button></div></body></html>",
  hasRoot: true,
  skeletonCount: 2,
  contentCount: 12,
};

t("healthy panel at exact geometry passes", () => {
  const v = classifyPanel(healthy);
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
});

t("wrong viewport is flagged with the exact mismatch", () => {
  const v = classifyPanel({ ...healthy, width: 1920, height: 1080 });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes("1920x1080") && r.includes("1366x1024")));
});

t("missing #root is flagged (page did not mount)", () => {
  const v = classifyPanel({ ...healthy, hasRoot: false });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes("#root")));
});

t("cloudflare 1033 error marker is flagged", () => {
  const v = classifyPanel({
    ...healthy,
    html: "<html><body>Error 1033: Argo Tunnel error</body></html>",
  });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes("error 1033")));
});

t("cf-error-details wrapper marker is flagged", () => {
  const v = classifyPanel({
    ...healthy,
    html: '<div class="cf-error-details">…</div>',
  });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes("cf-error-details")));
});

t("only one cloudflare reason even with multiple markers", () => {
  const v = classifyPanel({
    ...healthy,
    html: "error 530 error 521 cf-wrapper",
  });
  const cf = v.reasons.filter((r) => r.includes("cloudflare/origin error marker"));
  assert.equal(cf.length, 1);
});

t("all-skeleton board with no content is flagged as stuck", () => {
  const v = classifyPanel({ ...healthy, skeletonCount: 8, contentCount: 0 });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.some((r) => r.includes("only skeletons")));
});

t("skeletons WITH content is healthy (tiles still loading is fine)", () => {
  const v = classifyPanel({ ...healthy, skeletonCount: 5, contentCount: 7 });
  assert.equal(v.ok, true);
});

t("multiple faults accumulate distinct reasons", () => {
  const v = classifyPanel({
    width: 800,
    height: 600,
    html: "error 1033",
    hasRoot: false,
    skeletonCount: 3,
    contentCount: 0,
  });
  assert.equal(v.ok, false);
  assert.ok(v.reasons.length >= 4);
});

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`  ${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`  ${pass} passed, 0 failed`);
