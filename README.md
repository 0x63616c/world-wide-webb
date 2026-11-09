# World Wide Webb

A private home for independent apps, websites and homelab operations.

The consolidation is in progress on a local candidate. Production still follows its existing
sources until the verified handovers in the [migration tracker](docs/plans/monorepo-migration-progress.md).

## Products

- [Tendr](apps/tendr/README.md): native dose and health journal; owns `Packages/RDesign`.
- [Folding](apps/folding/README.md): native app, Rust Worker and product-owned delivery tools.
- [Callkeep](apps/callkeep/README.md): native Mac recording and transcription.
- [Air Miles](apps/airmiles/README.md): offline flight journal, independently styled.
- [Control Center](apps/control-center/README.md): native home controls and private Rust/SQLite service.

`sites/` contains public website sources. `infra/cloudflare/` contains retained infrastructure.
[Homelab](homelab/README.md) contains host configuration, runners, services and the CLI.
Root enrollment files preserve the installer contract; live source handover is pending.
App components stay with their own products; shared tooling standardizes checks and delivery.

## Work locally

Create a worktree with `wtp add -b codex/<task> origin/main`. Use the product README for setup.

```sh
swift test --package-path apps/tendr
swift test --package-path apps/airmiles
bash apps/control-center/tools/check ops
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
```

Tendr uses the root locked Ruby/Fastlane bundle. Folding keeps its own release bundle and
existing internal layout. Root `tools/check` and `tools/setup` preserve Control Center entrypoints.

## Delivery and migration

The [accepted plan](docs/plans/world-wide-webb-monorepo-2026-11-08.md) defines selective CI,
immutable delivery, private Homebrew installation, home ownership and repo retirement.
The selection policy in `scripts/ci/units.json` separates verification from delivery candidates;
selection alone never authorizes publication. Current pipelines are being adapted and verified.

Keep original repositories and worktrees until their imports, active changes, releases, issues,
compatibility URLs and recovery paths are accounted for. Excluded personal projects/data remain separate.
