# Codebase map

Start at the [repository README](README.md), then the README and root instructions
for the area you are changing. Products keep their own UI, tests, fixtures and
release details. Shared code owns selection and common entrypoints.

| Area | Owner and entry point |
| --- | --- |
| `projects/tendr` | iOS app, local `RDesign`, screenshots and listing. [README](projects/tendr/README.md) |
| `projects/folding` | iOS app, contracts, CloudKit, Rust Worker and product Fastlane. [README](projects/folding/README.md) |
| `projects/callkeep` | macOS app, transcription packages and notarized release. [README](projects/callkeep/README.md) |
| `projects/control-center` | Native client, Rust/SQLite server and deployment. Read its [source map](projects/control-center/CODEBASE_OVERVIEW.md). |
| `projects/golink-safari` | Safari extension and native container; the server lives in Homelab. [README](projects/golink-safari/README.md) |
| `projects/homelab` | Mac configuration, services, disposable runners and setup CLI. [README](projects/homelab/README.md) |
| `sites` | Shared landing page and approved publication list; product sites live in their projects. [README](sites/README.md) |
| `infra/cloudflare/home` | Retained shared OpenTofu state; Folding's state root lives in its project. |
| `secrets` | Retained encrypted shared vault; host ciphertext lives in `projects/homelab/secrets`. |
| `scripts/ci` and `.github` | Repository selection, verification and product delivery workflows. [Policy](scripts/ci/units.json) |
| `scripts`, `fastlane`, `templates`, `tools` | Local entrypoints, standard iOS delivery and new-app scaffold. [Development](docs/DEVELOPMENT.md) |
| `docs` | Shared developer, release and historical migration records. |
| `.agents/skills` | Vendored guidance and its [source record](.agents/skills/SOURCES.md). |
| `.codex`, `.config` | Shared agent and repository tool configuration. |

The old root `apps`, `homelab` and `bootstrap` directories now live in `projects`.
The root `mise.toml` and `mise.lock` pin shared developer tools.

The [release guide](docs/RELEASE.md) maps delivery channels. The
[migration completion record](docs/plans/monorepo-remaining-work-2026-11-09.md)
is historical; active work belongs in these directories, not retired checkouts.
