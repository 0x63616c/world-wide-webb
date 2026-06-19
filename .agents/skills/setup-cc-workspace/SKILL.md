---
name: setup-cc-workspace
description: Use when Calum wants to run/start/spin up control-center locally, set up a dev workspace, view the app, or view the Tilt logs, runs the Tilt dev stack (postgres + api + worker + web + storybook) and opens the app and log UI in cmux views.
---

# Set Up Control-Center Workspace

## Overview

One command brings up the full local dev stack and surfaces it in cmux: the Tilt
dev stack (postgres, api, worker, web, storybook), then the live app and the Tilt
log UI as cmux browser views. Everything hot-reloads, so edits show up live. The
`worker` process runs the continuous device-sync + weather-ingest loops (the api
is request-only); watch its logs in the Tilt UI to see reconcile/ingest cycles.

## When to Use

- "run control-center locally", "set up the workspace", "spin it up", "start the dev stack"
- "view the app" / "view the logs" / "open the dashboard"
- Beginning a session where you'll edit tiles or services and want to see changes live

## How

Run the script, it is idempotent (reuses a running Tilt) and fails fast on missing prereqs:

```bash
scripts/setup-workspace.sh
```

That's it. The script: checks prereqs (docker, tilt, bun, authenticated `op`) →
starts `bun run dev` detached (logs to `/tmp/cc-tilt.log`) → waits for the web app
on :4200 → `cmux open`s the Tilt UI (:10350) and the app (:4200).

## What You Get

| Surface | URL | Notes |
|---|---|---|
| Web app | http://localhost:4200 | the board, fixed 1366×1024 |
| API | http://localhost:4201 | tRPC backend (request-only) |
| Worker | (no HTTP) | device-sync + weather-ingest loops; logs in the Tilt UI |
| Tilt logs | http://localhost:10350 | per-service logs, restart + DB migrate/reset buttons |
| Storybook | http://localhost:6006 | tile primitives |

Raw stream: `/tmp/cc-tilt.log`. Stop everything with `tilt down`.

## Notes

- Secrets load via `op inject` from 1Password, so `op` must be authenticated first.
- Cold start is ~30–60s (api boots, db migrates, then web). The script blocks until :4200 serves.
- Hot reload: `bun --watch` for the api, Vite HMR for the web, no restart needed after edits.
