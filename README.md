# World Wide Webb

Independent apps, websites and homelab operations in one repository.

Repository consolidation is complete. Apps, homelab configuration, Cloudflare infrastructure
and delivery tooling live here. WWW is currently public; `dotfiles`, `homebrew-tap` and private
`github-archive` remain separate. The [migration record](docs/plans/monorepo-migration-progress.md)
records completed handovers and the deleted source repositories.

## Products

- [Tendr](apps/tendr/README.md): native dose and health journal; owns `Packages/RDesign`.
- [Folding](apps/folding/README.md): native app, Rust Worker and product-owned delivery tools.
- [Callkeep](apps/callkeep/README.md): native Mac recording and transcription.
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
bash apps/control-center/tools/check ops
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
```

Tendr uses the root locked Ruby/Fastlane bundle. Folding keeps its own release bundle and
existing internal layout. Root `tools/check` and `tools/setup` preserve Control Center entrypoints.

[Development](docs/DEVELOPMENT.md), [new apps](docs/NEW-APP.md) and [releases](docs/RELEASE.md)
describe the shared lifecycle and current handler boundaries.

## Delivery and migration

The [completion record](docs/plans/monorepo-remaining-work-2026-11-09.md) documents retained
archives and separate follow-ups. Tendr’s former GitHub Pages host was deleted by owner request;
replacement Cloudflare hosting and app/listing link updates are tracked in [#1007](https://github.com/0x63616c/world-wide-webb/issues/1007).
The selection policy in `scripts/ci/units.json` separates verification from delivery candidates;
selection alone never authorizes publication. Use each product’s release instructions and
channel flags; documentation changes do not request a product release.

The old `apps`, `folding`, `callkeep`, `homelab` and `homelab-cli` repositories were snapshotted
into private `github-archive` and deleted. Old local checkouts are historical; develop here.
Preserve active worktrees, signing storage and the agreed excluded projects/data.
