# World Wide Webb

Independent apps, websites and homelab operations in one repository.

Source consolidation is merged. Homelab configuration, home Cloudflare infrastructure and
website publication follow WWW. The [migration tracker](docs/plans/monorepo-migration-progress.md)
records completed handovers and remaining release/reference cleanup. WWW is currently public.

## Products

- [Tendr](apps/tendr/README.md): native dose and health journal; owns `Packages/RDesign`.
- [Folding](apps/folding/README.md): native app, Rust Worker and product-owned delivery tools.
- [Callkeep](apps/callkeep/README.md): native Mac recording and transcription.
- [Air Miles](apps/airmiles/README.md): offline flight journal, independently styled.
- [Control Center](apps/control-center/README.md): native home controls and private Rust/SQLite service.
- [Golink Safari](apps/golink-safari/README.md): Safari address-bar shortcuts for the tailnet Golink service.

`sites/` contains public website sources. `infra/cloudflare/` contains retained infrastructure.
[Homelab](homelab/README.md) contains host configuration, runners, services and the CLI.
Root enrollment files preserve the installer contract; both Macs follow WWW.
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

[Development](docs/DEVELOPMENT.md), [new apps](docs/NEW-APP.md) and [releases](docs/RELEASE.md)
describe the shared lifecycle and current handler boundaries.

## Delivery and migration

The [current finish plan](docs/plans/monorepo-remaining-work-2026-11-09.md) covers remaining
delivery references and old-repository cleanup. Earlier private-repository proposals are historical.
The selection policy in `scripts/ci/units.json` separates verification from delivery candidates;
selection alone never authorizes publication. Use each product’s release instructions and
channel flags; documentation changes do not request a product release.

Keep original repositories and worktrees until their imports, active changes, releases, issues,
compatibility URLs and recovery paths are accounted for. Excluded personal projects/data remain separate.
