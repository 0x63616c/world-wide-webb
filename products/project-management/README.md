# project-management

Live web UI for this project's **beads** issues. A project-management view (Board / Epics / Issues) for tracking the platform migration without the TUI.

It runs the Claude Design `Beads.dc.html` prototype (worldwidewebb design system) verbatim, wired to live beads data.

## Run

```bash
bun run dev            # serves on http://127.0.0.1:8791
bun run start          # same server, non-watch
bun run dev:temporal   # starts Temporal dev server plus the project-management worker
tilt up                # starts the UI, Temporal dev server, and Temporal worker
bun run test           # Vitest unit tests for mapper/server/workflow helpers
bun run typecheck      # TypeScript check for the standalone product
```

Then open `http://127.0.0.1:8791/`.

Env: `BEADS_UI_PORT` (default 8791), `BEADS_UI_SYNC_MS` (default 30000).

## Temporal workflow scaffold

The workflow runtime scaffold lives under `temporal/`:

- `temporal/workflows.ts` - deterministic Workflow definitions only. Workflow code must not shell out, read git state, call `bd`, read clocks, or perform network I/O.
- `temporal/activities.ts` - Activity boundary for non-deterministic work. Shell, git, and Beads operations belong here. The Beads adapter is intentionally not implemented yet.
- `temporal/worker.ts` - local Temporal worker registered on task queue `project-management`.
- `temporal/state.ts` - pure deterministic state transition logic covered by unit tests without a Temporal test server.

Local Temporal requires the Temporal CLI on `PATH`. Start both the dev server and worker from this package:

```bash
bun run dev:temporal
```

Or run them separately:

```bash
bun run temporal:server
bun run worker:temporal
```

Worker env: `TEMPORAL_ADDRESS` (default `127.0.0.1:7233`), `TEMPORAL_NAMESPACE` (default `project-management`), `TEMPORAL_TASK_QUEUE` (default `project-management`).

## How it works

- `server.ts` - Bun server, no deps. Shells `bd list --all --json` against the repo root and keeps an in-memory snapshot. Every 30s it runs `bd dolt pull` (read-only) then re-lists, so the UI tracks the dolt **remote**. It never writes or pushes issues.
- `map.ts` - pure mapper from raw `bd` issues to the prototype's shape (status/type/priority + the blockedBy/blocks/epic-children graph from bd dependencies). Covered by `map.test.ts`.
- `workflow.ts` - pure workflow-column helper for testable UI/workflow logic before Temporal lands.
- `temporal/` - Temporal runtime scaffold with deterministic workflows separated from non-deterministic activities.
- `public/` - the design bundle. `Beads.dc.html` (edited to fetch `/api/board-data` instead of mock `SEED`), `support.js` (DC runtime), `_ds/` (design system). The frontend polls every 10s.

## Workspace decision

Project Management intentionally remains a standalone product package excluded from root Bun workspaces. It is prototype-derived and not deployed yet, so keeping it standalone prevents root install/test/typecheck from owning the design handoff bundle or future workflow experiments by accident. The product still has its own reliable local TDD surface through `bun run test` and `bun run typecheck`, and root Biome can lint its TypeScript while `public/` stays excluded as generated design output.

## Views & features

- **Board** - Ready / In Progress / Blocked / Closed columns, sticky headers.
- **Epics** - milestones with rollup progress bars, sorted by most-recent.
- **Issues** - sortable table (click a column), status filters, search.
- **Detail drawer** - description, acceptance-criteria checklist, dependency links. `Esc` closes.
- **Settings** - switch UI font (saved per-browser; default Geist).

Read-only viewer: edits in the UI don't persist (by design - it mirrors the remote).
