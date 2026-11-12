# Codebase map

Start at the [repository README](README.md), then the README and local instructions
for the area you are changing. Products keep their own UI, tests, fixtures and
release details. Shared code owns selection and common entrypoints.

| Area | Owner and entry point |
| --- | --- |
| `apps/tendr` | iOS app, local `RDesign`, screenshots and listing. [README](apps/tendr/README.md) |
| `apps/folding` | iOS app, contracts, CloudKit, Rust Worker and product Fastlane. [README](apps/folding/README.md) |
| `apps/callkeep` | macOS app, transcription packages and notarized release. [README](apps/callkeep/README.md) |
| `apps/control-center` | Native client, Rust/SQLite server and deployment. Read its [source map](apps/control-center/CODEBASE_OVERVIEW.md) and [instructions](apps/control-center/AGENTS.md). |
| `apps/golink-safari` | Safari extension and native container; the server lives in Homelab. [README](apps/golink-safari/README.md) |
| `homelab` | Mac configuration, services, disposable runners and setup CLI. [README](homelab/README.md) |
| `sites` | Tendr and Folding public sites with independent publication. [README](sites/README.md) |
| `infra/cloudflare` | Retained home and Folding OpenTofu state roots. |
| `scripts/ci` and `.github` | Repository selection, verification and product delivery workflows. [Policy](scripts/ci/units.json) |
| `scripts`, `fastlane`, `templates` | Local entrypoints, standard iOS delivery and new-app scaffold. [Development](docs/DEVELOPMENT.md) |
| `.agents/skills` | Vendored guidance and its [source record](.agents/skills/SOURCES.md). |

The [release guide](docs/RELEASE.md) maps delivery channels. The
[migration completion record](docs/plans/monorepo-remaining-work-2026-11-09.md)
is historical; active work belongs in these directories, not retired checkouts.
