# Development

Start with the [repository map](../CODEBASE_OVERVIEW.md) and the README for the
product you are changing. Product code, fixtures, UI and release details stay with
the product. Root tooling selects work and provides entrypoints; it does not turn
all products into one app.

## Start a task

```sh
wtp add -b codex/my-change origin/main
cd "$(wtp cd codex/my-change)"
mise install
scripts/dev doctor
```

Worktrees live outside the main checkout. `wtp add` runs `tools/setup` and installs
the repository's Lefthook pre-commit checks. If you created a worktree without
`wtp`, run `lefthook install`.
Read product-local `AGENTS.md` and setup instructions before changing that area.

Root `mise.toml` pins Bun, Node, Python, Ruby, XcodeGen and OpenTofu for local
work. Run commands with `mise exec -- …` or activate mise in your shell.
Folding's `mise.toml` selects its release Ruby version when working in that
directory. Product lockfiles and CI pins remain the release authority; the
mise pin check prevents common local versions drifting from them. Xcode and
simulator runtimes are installed separately; Rust toolchain files keep their
product-specific targets and components. The Homelab Nix flake lives under
`homelab/` and is not replaced by mise.
For `scripts/dev affected` and shared CI selector tests, create a local Python
environment with `mise exec -- python3 -m venv .venv`, install
`scripts/requirements.txt` into it, and put `.venv/bin` on `PATH` for those
commands. `scripts/dev doctor` reports a missing PyYAML dependency.

## Choose a local check

| Command | What it does |
| --- | --- |
| `scripts/dev apps` | List app folders known to the app manifest reader. |
| `scripts/dev check <app>` | Run that app's local handler. Standard iOS apps run package tests when declared and an unsigned simulator build; Folding, Callkeep and Control Center use their own handlers. |
| `scripts/dev homelab <area>` | Run focused Homelab planner, activation or backup tests. |
| `scripts/dev affected <base>` | Resolve affected apps for verification from committed changes. |
| `scripts/dev doctor` | Report missing shared tools; product pins, Apple runtimes and account readiness are checked in their own workflows. |

Prefix these commands with `mise exec --` if your shell has not activated mise.

The product README supplies narrower commands and required toolchains. For example,
Tendr package tests run with `swift test --package-path projects/tendr`; Folding's
backend and native checks are separate. Run the affected checks while iterating,
then the relevant integration and required CI checks for the completed change.
Documentation-only edits need link and documentation checks, not app builds.

## From change to delivery

1. Make a coherent change in its product area. Keep private records, credentials,
   signing material and generated release evidence out of Git.
2. Check the changed behavior through existing product handlers. Review the diff
   and record any remaining limits honestly.
3. Publish the candidate, pass required checks and merge through the repository's
   normal review flow. A green test does not prove Apple processing or a live host.
4. Verify the affected delivery outcome when the change selects one. See
   [releases](RELEASE.md) for each channel.

[scripts/ci/units.json](../scripts/ci/units.json) is the selection policy. It
names verification units and delivery inputs separately. Tests and documentation
can trigger verification without publishing another product. Product release
handlers own external writes; do not run multiple publishers for the same target.

## Ownership and toolchains

- Apps choose their SwiftUI components and architecture. Tendr's `RDesign`,
  Folding's `FoldingKit`, and Control Center's native packages remain local.
- Fastlane handles Apple distribution. Tendr uses the root Ruby bundle; Folding
  keeps its product bundle. Callkeep and Control Center have their own handlers.
- Bun is the JavaScript default where a product uses it. Keep Rust, Node, Python
  and other runtimes required by actual product tools and lockfiles.
- OpenTofu owns durable Cloudflare resources; Wrangler owns Worker code/assets.
  Homelab host promotion is distinct from authoring changes on `main`.

The [new-app guide](NEW-APP.md) covers scaffolding. Historical migration evidence
lives under `docs/plans/`; use current product runbooks for active operations.
