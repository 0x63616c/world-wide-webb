# Development

Start with the [repository map](../CODEBASE_OVERVIEW.md) and the README for the
product you are changing. Product code, fixtures, UI and release details stay with
the product. Root tooling selects work and provides entrypoints; it does not turn
all products into one app.

## Start a task

```sh
wtp add -b codex/my-change origin/main
cd "$(wtp cd codex/my-change)"
scripts/dev setup tendr
scripts/dev doctor
```

Worktrees live outside the main checkout. `wtp add` runs `tools/setup` and installs
the repository's Lefthook pre-commit checks. If you created a worktree without
`wtp`, run `lefthook install`.
Read the root `AGENTS.md` and product README before changing that area.

Root `mise.toml` and `mise.lock` pin Bun, Node, Python, uv, Ruby, XcodeGen and
OpenTofu for local work. `scripts/dev setup <project>` installs them and creates
the Python environment from `scripts/requirements.txt`. Product lockfiles and CI
pins remain the release authority; the mise pin check prevents common local
versions drifting from them. Xcode and simulator runtimes are installed
separately; Rust toolchain files keep their product-specific targets and
components. The Homelab Nix flake lives under `projects/homelab/` and is not
replaced by mise. Put `.venv/bin` on `PATH` for `scripts/dev affected` and shared
CI selector tests; `scripts/dev doctor` reports a missing PyYAML dependency.

## Choose a local check

| Command | What it does |
| --- | --- |
| `scripts/dev list` | List every project. |
| `scripts/dev setup <project>` | Install pinned tools and shared Python requirements, then run project setup. |
| `scripts/dev check <project>` | Run its local handler. Standard iOS apps run package tests when declared and an unsigned simulator build; Folding, Callkeep, Control Center, Golink and Homelab use their own handlers. |
| `scripts/dev homelab <area>` | Run focused Homelab planner, activation or backup tests. |
| `scripts/dev affected <base>` | Resolve affected apps for verification from committed changes. |
| `scripts/dev doctor` | Report missing shared tools; product pins, Apple runtimes and account readiness are checked in their own workflows. |

`scripts/dev check` invokes mise for pinned project tools even when your shell has
not activated it.

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

The [new-app guide](NEW-APP.md) covers copying a living app. Historical migration
evidence lives under `docs/plans/`; use current product runbooks for active operations.
