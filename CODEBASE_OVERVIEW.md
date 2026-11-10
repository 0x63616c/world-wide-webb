# Codebase overview

Products live in `apps/<product>`, with independent build roots, tests and design choices.
Start with [README.md](README.md) and the relevant product README.

- `apps/tendr`: SwiftUI app and core tests, app-local `Packages/RDesign`, listings and fixtures.
- `apps/airmiles`: SwiftUI flight journal, domain package and offline import tests.
- `apps/folding`: preserved iOS/Rust Worker/contracts layout and product Fastlane machinery.
- `apps/callkeep`: macOS recording/transcription source, packages and release scripts.
- `apps/golink-safari`: macOS/iPhone/iPad Safari extension and native setup app; independent from the Golink server.
- `apps/control-center`: complete native Swift/Rust/SQLite product. Read its
  [source map](apps/control-center/CODEBASE_OVERVIEW.md) before changing it.
- `homelab`: desired host state, operations, runners and local CLI; root flake/enrollment files delegate here.
- `scripts/ci`: repository-wide input selection and isolation tests. Test-only changes verify without delivery.
- `scripts`, `fastlane`, `templates`: imported Tendr delivery/scaffolding handlers, being adapted.
- `sites`: static website source; installed legacy URLs are retained until replacement proof.
- `infra/cloudflare`: retained home infrastructure; separate home and Folding state roots with preserved resource addresses.
- `.github`: selective product pipelines and shared actions, with product pins and configured hosted/homelab routes. The migration tracker records live channel ownership.
- `.agents/skills`: pinned Apple and Matt Pocock guidance; provenance in `SOURCES.md`.

[Migration progress](docs/plans/monorepo-migration-progress.md) distinguishes local evidence from
unverified delivery. Source relocation changes no bundle identity, installed service, data directory
or production ownership by itself.
