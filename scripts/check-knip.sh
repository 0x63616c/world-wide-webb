#!/usr/bin/env bash
# Dead-code ratchet guard (CC-k6p1).
#
# Runs knip (the dead-code detector, configured in knip.jsonc) and BLOCKS when
# any finding category grows beyond the committed baseline in .knip-baseline.json.
# Existing debt is tolerated; the counts can only go DOWN. This is the mechanical
# invariant that replaces an agentic "go find dead code" loop: the repo physically
# rejects NEW unused files / exports / deps on every push and in CI.
#
#   bash scripts/check-knip.sh            # compare to baseline (CI / pre-push)
#   bash scripts/check-knip.sh --update   # rewrite the baseline from current state
#
# After removing dead code (e.g. `bun run knip:fix`), the counts shrink, the guard
# tells you to run --update, and you commit the lowered .knip-baseline.json. That
# ratchets the floor down so the debt can never silently grow back.
#
# Hermetic-test hook: set KNIP_REPORT_FILE to a pre-captured `knip --reporter json`
# file to skip invoking knip (used by scripts/test-check-knip.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

# Baseline path is overridable for hermetic tests (scripts/test-check-knip.sh).
BASELINE="${KNIP_BASELINE_FILE:-.knip-baseline.json}"
FLAG="${1:-}"

REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT

if [[ -n "${KNIP_REPORT_FILE:-}" ]]; then
  cp "$KNIP_REPORT_FILE" "$REPORT"
else
  # knip exits non-zero whenever it finds anything; we parse the JSON regardless,
  # so `|| true` keeps `set -e` from aborting on the expected non-zero exit.
  bunx knip --no-progress --reporter json >"$REPORT" 2>/dev/null || true
fi

python3 - "$REPORT" "$BASELINE" "$FLAG" <<'PY'
import json, sys

report_path, baseline_path, flag = sys.argv[1], sys.argv[2], sys.argv[3]

# Every category knip can emit; we ratchet each independently so a drop in one
# can't mask a rise in another.
CATS = [
    "files", "dependencies", "devDependencies", "optionalPeerDependencies",
    "unlisted", "binaries", "unresolved", "exports", "nsExports", "types",
    "nsTypes", "enumMembers", "duplicates",
]

try:
    data = json.load(open(report_path))
except Exception as e:
    # Never hard-block on a tooling hiccup (matches the repo's graceful-degrade guards).
    print(f"knip: could not parse report ({e}); skipping ratchet")
    sys.exit(0)

counts = {c: 0 for c in CATS}
for item in data.get("issues", []):
    for c in CATS:
        v = item.get(c)
        if isinstance(v, (list, dict)):
            counts[c] += len(v)
        elif v:
            counts[c] += 1
counts = {k: v for k, v in counts.items() if v}

if flag == "--update":
    with open(baseline_path, "w") as f:
        json.dump(counts, f, indent=2, sort_keys=True)
        f.write("\n")
    print("knip baseline updated:", counts or "{} (zero findings — clean!)")
    sys.exit(0)

try:
    base = json.load(open(baseline_path))
except FileNotFoundError:
    print(f"knip: no baseline at {baseline_path}; run `bash scripts/check-knip.sh --update`")
    sys.exit(0)

all_cats = set(counts) | set(base)
grew = [(c, base.get(c, 0), counts.get(c, 0)) for c in all_cats if counts.get(c, 0) > base.get(c, 0)]
shrank = [(c, base.get(c, 0), counts.get(c, 0)) for c in all_cats if counts.get(c, 0) < base.get(c, 0)]

if grew:
    print("✖ knip: NEW dead code introduced (category counts grew beyond baseline):")
    for c, b, n in sorted(grew):
        print(f"    {c}: {b} → {n}")
    print("\n  Inspect with `bun run knip`. Remove the dead code (or `bun run knip:fix`")
    print("  for the auto-removable ones), then re-commit. Do NOT just bump the baseline.")
    sys.exit(1)

if shrank:
    print("✖ knip: dead code was REDUCED — lock in the win by lowering the baseline:")
    for c, b, n in sorted(shrank):
        print(f"    {c}: {b} → {n}")
    print("\n  Run `bash scripts/check-knip.sh --update` and commit .knip-baseline.json")
    print("  so the ratchet floor drops and the debt can't silently grow back.")
    sys.exit(1)

print("✓ knip: no new dead code (baseline holds)")
PY
