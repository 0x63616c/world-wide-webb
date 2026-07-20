#!/usr/bin/env bash
#
# Runs BOTH vitest projects: the jsdom unit suite (api + web + workers +
# packages + infra) and the Storybook browser suite (Playwright/Chromium).
#
# They are two invocations because the Storybook project must run from
# products/control-center/web (its storybookScript and setup paths are relative
# to that dir).
#
# No coverage: it was only ever collected to feed README badges, which were
# removed in c2fcd87b8 (2026-06-20). Coverage was never a gate — see the note in
# vitest.config.ts — so dropping the instrumentation changes no pass/fail
# outcome, it just removes the v8 overhead from every push.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Unit projects (jsdom).
bunx vitest run

# 2) Storybook project (chromium). Runs from products/control-center/web.
( cd products/control-center/web && bunx vitest run --project storybook )
