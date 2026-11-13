# World Wide Webb

Apps, websites and homelab software developed in one repository. Each product owns
its code and user experience; shared tooling selects checks and delivery work.

## Find a product

| Product | What lives here | Start here |
| --- | --- | --- |
| Tendr | iPhone health journal and public website | [App](projects/tendr/README.md) · [Site](sites/README.md) |
| Folding | iPhone folding tracker, Rust Worker and website | [App](projects/folding/README.md) · [Backend](projects/folding/backend/README.md) |
| Callkeep | macOS recording and transcription app | [App](projects/callkeep/README.md) |
| Control Center | iPad/iPhone home controls and private Rust service | [Product](projects/control-center/README.md) · [Source map](projects/control-center/CODEBASE_OVERVIEW.md) |
| Golink for Safari | Safari client for the tailnet Golink service | [Extension](projects/golink-safari/README.md) · [Service](projects/homelab/docs/golink.md) |
| Homelab | Mac configuration, services, runners and setup CLI | [Hosts](projects/homelab/README.md) · [CLI](projects/homelab/cli/README.md) |

The [source map](CODEBASE_OVERVIEW.md) covers the shared directories and ownership
boundaries. Product READMEs give the commands and deeper docs for their own areas.

## Work locally

Create a worktree from the current main branch, then enter it:

```sh
wtp add -b codex/my-change origin/main
cd "$(wtp cd codex/my-change)"
mise install
mise exec -- scripts/dev apps
mise exec -- scripts/dev check tendr
```

`wtp add` runs the repository's setup and installs Lefthook's local checks.
`mise.toml` pins common local tools; `mise exec` uses them without shell activation.
The product may require its own toolchain or runtime; start with its README. Use
`scripts/dev check <app>` for the product's local handler and
`scripts/dev homelab` for focused host checks. These commands do not publish.

Install the tracked Git hooks with `lefthook install` in each checkout and the locked
Prettier plugins with `bun install --frozen-lockfile`. The hook formats staged maintained
source and configuration files, stages formatting in the commit, and checks whitespace
in every staged file. It refuses partially staged source files to avoid including
unstaged edits. CI uses the same formatter command to check the full source baseline.
Run `bun run format` to format the full baseline locally or `bun run format:check` to
check it. Swift, Rust, Python, Ruby, Nix and OpenTofu use their native formatters;
JavaScript, TypeScript, HTML, CSS, JSON, YAML, Shell, SQL and TOML use locked Prettier
plugins. Applied SQL migrations and historical CloudKit receipts stay byte-for-byte intact;
their stored checksums must not change. Two security-sensitive scripts with existing CodeQL
findings are deferred to a focused security change. A push remains an explicit action after checks.

[Development](docs/DEVELOPMENT.md), [new apps](docs/NEW-APP.md) and [releases](docs/RELEASE.md)
describe the shared lifecycle and current handler boundaries.
## How changes ship

The [CI selection policy](scripts/ci/units.json) separates verification from
delivery. Successful main CI can start delivery only for selected product inputs;
documentation and tests alone do not request an app release.

| Change | Delivery path |
| --- | --- |
| Tendr or Folding app | Selected main changes reach internal TestFlight; a matching product tag submits the processed build to App Review. [App Store guide](docs/RELEASE.md#how-app-store-releases-work) |
| Folding Worker | Tested backend changes deploy through Folding's product handler. [Operations](projects/folding/fastlane/RELEASE.md) |
| Callkeep | Selected main changes publish a signed, notarized release and update its Homebrew cask. [Product release](projects/callkeep/README.md#release-automation) |
| Control Center | Native and service publishers are separate; host activation follows Homelab promotion. [Product](projects/control-center/README.md) |
| Websites | Tendr and Folding publish independently. [Site ownership](sites/README.md) |
| Homelab | Authoring `main` and deployment `deploy/homelab` are separate. [Updates](projects/homelab/docs/updates.md) |
| Golink for Safari | No automatic app publication. [Build and install](projects/golink-safari/README.md#build-and-install) |

## Guides

- [Development](docs/DEVELOPMENT.md): worktrees, local checks, CI and ownership.
- [Releases](docs/RELEASE.md): product channels, App Store review and publication.
- [New app](docs/NEW-APP.md): scaffold, build and distribution setup.
- [Agent instructions](AGENTS.md): repository rules for automated work.

The five repositories consolidated into this one were archived and deleted. Their
old checkouts are historical; active development and publication happen here. The
[migration completion record](docs/plans/monorepo-remaining-work-2026-11-09.md)
keeps the archive details and follow-ups without making them part of the daily workflow.
