// Static local-dev (Tilt) product-lane check (www-jtp0.4.7).
//
// M4 makes the dev stack product-selectable: every Tilt resource must declare
// which product lane it belongs to (a label that is a real product slug) or be
// explicitly marked shared platform infra. This lets `tilt up` filter the UI by
// product and keeps new products from silently joining an all-in-one Tiltfile.
//
// Red-first: against the original tier-only Tiltfile (labels=["backend"] etc.)
// this check fails because no resource carries a product-lane or shared label.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { productSlugs } from "@repo/platform";

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const tiltfile = readFileSync(join(repoRoot, "Tiltfile"), "utf8");

// Sanctioned non-product lane for shared platform infra (postgres, install).
const SHARED_LANE = "shared";
const validLanes = new Set<string>([...productSlugs, SHARED_LANE]);

type Resource = Readonly<{ name: string; labels: readonly string[] }>;

// Parse every local_resource("name", ...) and dc_resource("name", ...)
// declaration. Both inline (single-line dc_resource) and multiline forms exist,
// so segment the file by resource-call start offsets and read each segment's
// labels=[...] kwarg, rather than trying to balance parens with one regex.
function parseResources(): readonly Resource[] {
  const startRe = /(?:local_resource|dc_resource)\(\s*"(?<name>[^"]+)"/g;
  const starts: Array<{ name: string; index: number }> = [];
  for (const match of tiltfile.matchAll(startRe)) {
    starts.push({ name: match.groups?.name ?? "", index: match.index ?? 0 });
  }
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : tiltfile.length;
    const segment = tiltfile.slice(start.index, end);
    const labelsMatch = segment.match(/labels=\[(?<labels>[^\]]*)\]/);
    const labels = labelsMatch?.groups?.labels
      ? labelsMatch.groups.labels
          .split(",")
          .map((entry) => entry.trim().replace(/^"/, "").replace(/"$/, ""))
          .filter(Boolean)
      : [];
    return { name: start.name, labels };
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const resources = parseResources();
assert(resources.length > 0, "no Tilt resources parsed, the resource regex is stale");

// Every resource must declare exactly one product lane (a real product slug) or
// the shared infra lane.
const offenders: string[] = [];
for (const resource of resources) {
  const lanes = resource.labels.filter((label) => validLanes.has(label));
  if (lanes.length !== 1) {
    offenders.push(
      `${resource.name} (lanes: [${lanes.join(", ") || "none"}], labels: [${resource.labels.join(", ")}])`,
    );
  }
}
assert(
  offenders.length === 0,
  `Every Tilt resource must declare exactly one product lane ` +
    `(${[...productSlugs].join("|")}|${SHARED_LANE}). Offenders:\n  ${offenders.join("\n  ")}`,
);

// The Control Center product lane must be present, it is the product that runs
// locally today.
const controlCenterResources = resources.filter((resource) =>
  resource.labels.includes("control-center"),
);
assert(
  controlCenterResources.length > 0,
  "expected at least one resource on the control-center product lane",
);

const lanesUsed = new Set(
  resources.flatMap((resource) => resource.labels.filter((label) => validLanes.has(label))),
);
console.info(
  `Tilt product lanes OK: ${resources.length} resources, lanes used: ${[...lanesUsed].sort().join(", ")}.`,
);
