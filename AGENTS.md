# Agent Instructions

## Start here

- Read `CODEBASE_OVERVIEW.md` first — it's the map; this file is the rules.
- PR titles use Conventional Commits.

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
- Follow `docs/design/apple-native.md` for native UI changes. Apple system
  navigation and controls are the default; HomeView is the wall-panel reference.
  Use `design-system` for shared styles, `swiftui-pro` for review, and the
  `iphone-duo-*` skills for adaptive design, implementation and verification.
  Confirm new OS APIs against the installed SDK; never simulate system chrome.
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

Backend debugging starts with the mini's rotated container logs and `/healthz`.
See `docs/observability.md`. Browser/panel issues are debugged in the browser
or by reproducing locally. Grafana/Loki/Prometheus are retired; their final
archive is retained on the NAS. Do not add health alerts without user direction.

## Infra

- Production runs on the Mac mini (`homelab`) in OrbStack: one ARM64 app
  container from the root Dockerfile plus PostgreSQL 18. Compose and release,
  recovery and backup scripts live in `deploy/mini/`.
- Home Assistant runs in its bridged Colima VM at `192.168.0.130`; host startup
  and networking configuration live in `deploy/mini/`. Hindsight and Bambuddy
  remain independent services with persistent data and verified backups.
- Push to `main` runs hosted CI. A successful run triggers `deploy-mini.yml`,
  which builds the exact tested revision, publishes an immutable digest, and
  invokes the mini's serialized release script over Tailscale SSH. There are
  no local GitHub runners. Never bypass required checks.
- Cloudflare DNS, Access and tunnel ingress remain managed by the separate
  `infra/cloudflare` Pulumi project, stack `prod`.
- Talos is shut down. Its disks and recovery archives are retained; do not
  reset them or restart old writers against stale databases. See
  `docs/runbooks/mac-mini-migration.md` for the migration evidence and gaps.
- Nightly backups use `deploy/mini/backup.py` and a 04:15 LaunchAgent. Files
  are copied to the NAS and read back for SHA-256 verification. Backups contain
  secrets and must stay outside Git. There are no new notifications.
- App-level scheduled work remains a plain interval cycle declared in
  `features/<id>/worker.ts`; there is no job queue or workflow engine.
  Device-local native-shell maintenance uses local calendar semantics and a
  pure tested scheduling seam.
- The iOS panel shell (`apps/panel`, Expo) needs Xcode 26.4+; CI selects
  `XCODE_VERSION` in `.github/workflows/ios-build.yml`. `apps/panel/ios` is
  generated and gitignored; change `apps/panel/app.config.ts` instead.

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
  open PRs. Use a Conventional Commit title and describe the change and validation.
- **Nobody merges a red PR or skips required checks.** `main` has a
  `pipeline-required-checks` ruleset with no bypass: Conventional Commit title, changes, typecheck, test-unit, build-and-test.
  Never use `gh pr merge --admin`, the "Merge without waiting for
  requirements to be met" button, or the raw merge API to skip checks.
  The separate code-owner ruleset requires one Code Owner (@0x63616c)
  approval, which Calum bypasses; a normal `gh pr merge --squash` works
  once required checks pass. This does not permit pipeline executors to merge.
- **Merging to `main` deploys to prod** (push-to-main triggers CI + deploy),
  so merging the PR is the deliberate act. Merge once CI is green; don't
  merge a red PR.
- For Calum's direct interactive change requests, completion includes pushing,
  opening the PR, fixing required checks, normally merging the current green
  head, and verifying deployment (including Apple processing for TestFlight).
  Do not ask again for these routine steps unless he requests local-only,
  draft, or no-merge work. This does not change the pipeline executor boundary
  or permit bypassing checks. Show videos for visible interaction changes.
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
