#!/usr/bin/env bash
#
# Merged coverage across BOTH vitest projects: the jsdom unit suite (api + web)
# and the Storybook browser suite (Playwright/Chromium). They run as two
# separate invocations because the Storybook project must run from apps/web (its
# storybookScript + setup are relative to that dir), so we record each as a vitest
# "blob" report and merge them into one coverage summary.
#
# Why merged: a unit-only run counts the ~95 story-tested presentational
# components as 0%, badly undercounting (www-hjvu / follow-on from www-afz). The
# merged number reflects unit + Storybook interaction coverage.
#
# Output: coverage/coverage-summary.json (consumed by scripts/gen-badges.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .vitest-reports coverage

# 1) Unit projects (jsdom) -> blob
bunx vitest run --coverage --reporter=blob --outputFile=.vitest-reports/unit.json

# 2) Storybook project (chromium) -> blob. Runs from apps/web; serialized via the
#    project's fileParallelism:false so it's deterministic.
( cd apps/web && bunx vitest run --project storybook --coverage --reporter=blob \
    --outputFile=../../.vitest-reports/storybook.json )

# 3) Merge both blobs and emit the combined coverage summary.
bunx vitest run --mergeReports=.vitest-reports --coverage --coverage.provider=v8 \
  --coverage.reporter=json-summary --coverage.reporter=text-summary
