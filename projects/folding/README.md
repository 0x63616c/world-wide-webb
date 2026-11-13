# Folding

A free, native iPhone Duo folding tracker with personal statistics, guided
Shortcuts setup, iCloud sync, widgets and optional competition. The app and its
production Rust Worker are developed here; [getfolding.app](https://getfolding.app)
is the public website. App Store and TestFlight status belongs in current delivery
receipts, not a pinned build number in this README.

## Find the source

- [iOS app](apps/ios/README.md) and [FoldingKit](apps/ios/Packages/FoldingKit/README.md)
- [Backend](backend/README.md), [contracts](contracts/README.md) and [CloudKit](cloudkit/README.md)
- [Architecture](docs/architecture.md) and [domain glossary](GLOSSARY.md)
- [Technical specifications](docs/technical/README.md) and [review specification](docs/review-spec.md)

The [work tracker](docs/work-tracker.md) summarizes current product work. Use
[WWW issues](https://github.com/0x63616c/world-wide-webb/issues) for active
issues; old repository links in historical documents are archival references.
The review specification records remaining device/provider acceptance separately
from implemented release automation.

## Develop

Run product commands from `projects/folding`. Bootstrap its pinned tools, then run
focused checks for the area changed:

```sh
scripts/bootstrap
scripts/check
scripts/check-backend
```

Run `mise install` from the repository root for the shared Ruby/Bun/Node pins used
by Folding's release bundle. Use `mise exec --` when mise is not activated in your
shell. Xcode and the Duo simulator remain separate installed dependencies.

`scripts/check` covers contracts, personal core, localization and formatting;
`scripts/check-backend` covers the Worker. Use `scripts/format` for owned Swift
and OpenTofu files. Native simulator verification runs through
`bundle exec fastlane ios verify_app`. Root CI selects Folding app, backend and
contract checks independently. Read the [root instructions](../../AGENTS.md) before live
integration or deployment changes.

## Release

Selected main changes deliver an internal TestFlight build. A matching
`folding/vX.Y.Z` tag promotes that processed build to App Review after current
screenshots and product prerequisites pass. See the shared
[App Store release guide](../../docs/RELEASE.md#how-app-store-releases-work) for
version and review-state behavior, and [Folding operations](fastlane/RELEASE.md)
for immutable archives, Worker checks and recovery. Public site publication has
its own [owner](../../sites/README.md#folding-publication).

Planning and research records under `docs/` retain their original decision labels
and dates; use current code and runbooks for implementation and release behavior.
