# Agent Instructions

## Start here

- Read `CODEBASE_OVERVIEW.md` first — it's the map; this file is the rules.
- [Tickets](https://tickets.worldwidewebb.co) is the sole source of truth for
  work across all projects; this repo uses the `WWW` prefix. GitHub issues and
  Projects boards are retired. Track dependencies with Tickets dependency edges.
- PR titles are Conventional Commits ending with the ticket key, for example
  `feat(app): add thing [WWW-12]`. Start the body with the linked ticket,
  `Closes [WWW-12](https://tickets.worldwidewebb.co/t/WWW-12)` (or `Refs [WWW-12](https://tickets.worldwidewebb.co/t/WWW-12)` to link without closing); CI checks it. The Tickets GitHub webhook links the
  PR, moves the ticket to In review on opening, and to Done on merge.
- On the box, start work with `P=$(job new world-wide-webb WWW-12 [slug]); source "$P/.job.env"`.
  Source an existing `.job.env` before running checks. Model labels remain
  `model:astra` (`-m gpt-6-astra -c model_reasoning_effort=xhigh`) and
  `model:sol` (`-m gpt-6.1-sol`).

## Agent skills

- Repo skills live in `.agents/skills/` (Codex discovers them automatically;
  sources, pinned commits and licenses are in `.agents/skills/SOURCES.md`).
- For any SwiftUI / Apple-platform UI work (e.g. `apps/apple-prototype/`), use
  them: `swiftui-liquid-glass` (iOS/iPadOS) and `liquid-glass` (macOS) for the
  real Liquid Glass APIs, never hand-rolled blur or fake glass;
  `swiftui-expert-skill` for modern SwiftUI; `swiftui-patterns` for macOS
  scenes and windows; `animation-patterns` for springs, phase/keyframe
  animators, transitions, symbol effects, `TimelineView` and `MeshGradient`; `apple-hig` for HIG rules and exact
  measurements.
- Vendored skills are copied verbatim; update by re-copying from upstream and
  bumping the pinned commit in `SOURCES.md`, not by editing in place.

## Invariants

- **Design for 10x-100x this repo's size** — never reject a shared primitive
  on "few call sites today". Get data layout (paths, schema, IDs, on-disk
  formats) right up front; code interfaces refactor cheaply later.
- Shared primitives live in `packages/platform`, enforced by a Biome rule
  banning the raw escape hatch (see sound bus, below).
- Fixed wall panel, `1366x1024`, not responsive. Enforced by the OS on the
  native/Expo kiosk shell and the physical panel hardware. The web build
  matches it too, via `apps/web/src/components/PanelFrame.tsx`: it caps the
  app to `1366x1024` and, on a desktop browser with room to spare, frames it
  like a device instead of letting the board stretch to fill the window.
  `PanelFrame` is a no-op passthrough on native, so this never touches the
  panel/native behavior above.
  - **The Board is the non-responsive surface; the app is not the Board.** A
    PHONE gets a different screen, not a scaled board:
    `apps/web/src/components/MobileBoard.tsx`, a scroll column of the two
    tiles worth reaching for a phone to use (quick Controls + Climate · A/C),
    chosen by the route (`routes/index.tsx`), not by a branch inside Board.
    Ask `useIsMobile()` (`apps/web/src/lib/mobile.ts`), the one place that
    decides what a phone is (narrow viewport per `lib/useIsNarrow.ts`, OR a
    phone UA; iPad never counts, it IS the panel). `PanelFrame` is a
    passthrough there for the same reason it is on native.
- Features are self-contained Apps under `features/<id>/` (manifest + facets:
  `web.tsx`, `detail.ts`, `api.ts`, `http.ts`, `worker.ts`, `schema.ts`); the
  folder existing is the App's registration (ADR-0001). Tile placement is declared
  as registry coords in the App's `manifest.ts`, glob-collected and emitted to
  checked-in `features/_generated/*.gen.ts` by `bun run apps:gen` (ADR-0002).
  The Board and Tile Detail Host consume `web.gen.ts`; never hand-edit
  `_generated/`. App manifests also own Panel access policy: `sensitive`
  reuses the shared PIN Session and `private` requires a fresh PIN per
  opening. Detail facets must not redeclare access.
  `bun run apps:check` re-runs codegen and fails on drift.
  `scripts/apps-gen/validate.ts` is the consistency check (dup id/router-key/
  table/worker-cycle, ≠1 `home` tile, overlapping tile rects, all throw).
  Shared DB substrate lives in `packages/core` (`@www/core`).
- Dependency boundaries between `packages/*`, `features/*`, and `apps/*` are
  enforced by a Biome `noRestrictedImports` rule, not a separate
  dependency-graph tool.
- Use shared UI primitives from `apps/web/src/components/ui/`.
- Full-screen pages over modals for new tiles' detail views.
- Panel audio goes through the sound bus: `playCue()` from
  `apps/web/src/lib/sound/`. Add a named cue; never construct `AudioContext`
  or `Audio` elsewhere (Biome-enforced). Loudness is device volume, never
  in-app gain.
- No fake or placeholder data.
- IDs default to `prefix_<id>` — mint them with `genId()` from
  `packages/platform` (never hand-roll `prefix_${crypto.randomUUID()}`); a
  lefthook guard blocks hand-rolled ids outside `packages/platform/src/index.ts`.
- Backend code uses structured logging (`@www/logger`, never `console.*`).
- **Never read secret values** (e.g. contents of `secrets/vault.yaml`).
  Checking key names/presence is fine; do not print or inspect the decrypted
  values.

## Debugging

Backend debugging starts in Grafana — `https://grafana.worldwidewebb.co`
(Cloudflare Access email OTP). Metrics from Prometheus, every container's
logs from Loki (labels `namespace` `pod` `container` `app` `service`
`level`; 14-day retention). See `docs/observability.md`. There is no separate
frontend log pipeline — panel/browser issues are debugged from the browser
console or by reproducing locally, not queried from a store.

## Infra

- **"prod" = the `home-server` Talos node** (`192.168.0.5`, single
  control-plane, amd64, RTX 3060). No other production environment.
- **There is NO SSH into home-server.** Talos ships no shell and no sshd; port
  22 is closed by design. Administer it with `talosctl` (node) and `kubectl`
  (cluster) — `export TALOSCONFIG=$PWD/infra/talos/clusterconfig/talosconfig`
  then `talosctl dashboard`. The binary is `talosctl`, not `talos`, and needs
  no `-e`/`-n` (endpoint + node are baked into the talosconfig).
- `infra/talos/clusterconfig/` is gitignored and regenerated per session
  (`talhelper genconfig`) — it holds the cluster CA and admin client key.
  Machine config source of truth is `infra/talos/talconfig.yaml`.
- Deploy the `home-server` Pulumi stack. Images are **amd64-only**; the node
  is x86.
- Push to `main` triggers CI + deploy.
- CI/deploy is product-aware: per-product path filters build only changed
  product images plus shared-package dependents.
- Pulumi digest pins use `wwwinfra:imageDigests.*`.
- The iOS panel shell (`apps/panel`, Expo) needs Xcode 26.4+; CI selects
  `XCODE_VERSION` in `.github/workflows/ios-build.yml` rather than the runner
  default. `apps/panel/ios` is prebuild output (gitignored) — change native
  behavior in `apps/panel/app.config.ts`, never by hand-editing `ios/`.
- Infra-level cron jobs (backups) live in `infra/src/crons.ts`; app-level
  scheduled work is a plain interval cycle declared in `features/<id>/worker.ts`
  — there is no job queue and no workflow engine. Device-local native-shell
  maintenance that must run without backend connectivity is not app-level
  scheduled work: schedule it in the native shell using local calendar
  semantics, and keep the scheduling decision behind a pure tested seam.

## Workflow

- **Never edit in the main checkout — always `wtp add` a worktree first.**
  `wtp add <branch>` for an existing branch, `wtp add -b <new-branch>
  origin/main` for a new one — base new work on `origin/main`, since the local
  main checkout is usually well behind. `.wtp.yml` puts every worktree under
  `~/.worktrees/world-wide-webb/` (never nested in `.claude/worktrees/` or any
  repo subfolder — that's what caused lefthook/env setup to be flaky) and its
  `post_create` hooks run `bun install` + `lefthook install` automatically,
  then retarget the new branch's upstream from inherited `origin/main` to its
  eventual same-named `origin/<new-branch>` ref. This keeps `git status`,
  `git pull`, and a normal push scoped to the feature branch even before its
  first push. A fresh worktree is immediately usable. See #182.
  - A `PreToolUse` guard (`.claude/hooks/guard-worktree-only.sh`, shared by
    Claude Code and Codex) enforces this. It judges Edit/Write/`apply_patch`
    by the **target file's** path, not by your cwd, so writing into a
    worktree from a main-checkout session is allowed and writing into the
    main checkout never is. If you hit it you're pointed at the wrong
    directory, not wrongly permissioned. Table test:
    `bash .claude/hooks/guard-worktree-only.test.sh`.
  - **Agents (Claude Code): do not try to relocate the session.** `wtp cd`
    only moves a shell subprocess, and `EnterWorktree` is unusable here — it
    accepts only worktrees it created under `.claude/worktrees/`, so `{path:
    ...}` to a wtp worktree is rejected by the harness, and `{name: ...}`
    would create a nested checkout that skips wtp's hooks. Both forms are
    guard-denied. Stay where you are and drive the worktree by absolute path
    instead: `git -C <worktree> ...`, and absolute `<worktree>/...` paths for
    Edit/Write.
  - **Never `git worktree remove` or `git branch -D`.** Other sessions own
    worktrees and branches you cannot see, and an idle-looking worktree is
    usually someone's live work — hand-cleanup has already destroyed a peer
    session's branch. Guard-denied from every directory, main or worktree.
    Stale worktrees are reaped by an hourly prune job.
- **Box pipeline executors implement, verify and commit only.** Commit on
  the task's branch and stop; do not push or open, edit, merge or close PRs.
  One wrapper (`codex-loop` on the box, later `pipeline`) owns publishing
  and merging: it pushes, opens the PR against `main` using the PR template,
  and follows the run's intent (default: merge when required checks are
  green; honour draft/no-merge).
- **Commit often, without asking.** Commit each coherent change (passing
  test, working slice, doc update); never batch. For pipeline runs, pushing
  is the publisher's job.
- Humans and interactive agents Calum asked directly may still push and
  open PRs. Use title `type(scope): title [KEY-N]` and start the body with
  `Closes [KEY-N](https://tickets.worldwidewebb.co/t/KEY-N)`; the pipeline
  uses this format too. Use this repo's `WWW` ticket prefix.
- **Nobody merges a red PR or skips required checks.** `main` has a
  `pipeline-required-checks` ruleset with no bypass: Ticket key,
  Conventional Commit title, changes, typecheck, test-unit, build-and-test.
  Never use `gh pr merge --admin`, the "Merge without waiting for
  requirements to be met" button, or the raw merge API to skip checks.
  The separate code-owner ruleset requires one Code Owner (@0x63616c)
  approval, which Calum bypasses; a normal `gh pr merge --squash` works
  once required checks pass. This does not permit pipeline executors to merge.
- **Merging to `main` deploys to prod** (push-to-main triggers CI + deploy),
  so merging the PR is the deliberate act. Merge once CI is green; don't
  merge a red PR.
- Verify before publishing (`bun run typecheck`, relevant tests). On failure,
  fix forward and commit on the branch; the publisher pushes the fix and
  waits for required checks to pass before merging.
- **Every PR description includes a screenshot.** Calum reviews what a change
  looks like, not a prose description of it. UI changes: screenshot the real
  thing running (tile face and, if it has one, its detail page) with the
  browser tooling, at the panel's `1366x1024`. Non-UI changes: screenshot the
  evidence instead (the passing test run, the Grafana panel, the API
  response). Commit the PNGs under `docs/screenshots/<feature>/` and embed
  them with a raw GitHub URL pinned to the commit SHA, so the images survive
  branch deletion. There is no other image host for PR descriptions.
- Keep docs current when behavior changes.
