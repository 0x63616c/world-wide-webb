# Folding

A free, native iPhone Duo folding tracker: personal statistics, guided Shortcuts setup, iCloud sync, and optional competition.

**Status:** **1.0.1 (29)** is available in **Folding Internal** on TestFlight.
App Store **1.0.1 (29)** is **Waiting for Review**, with actual simulator-screen screenshots.
Native source, the live Rust Worker and main TestFlight delivery and tagged App Store promotion use WWW.
Final device/provider acceptance remains owner-deferred under F13. The registered app is
Folding (`app.getfolding.Folding`), at **getfolding.app**. Source lives here;
historical imported receipts remain preserved in private archives. See the [current delivery checkpoint](docs/work-tracker.md).

## Start here

Read the [complete v1 specification for review](docs/review-spec.md). It is the authoritative consolidated proposal, with straightforward defaults chosen at the owner's request. Earlier detailed notes are retained as historical context.

Start implementation planning with the [delivery plan through App Store submission](docs/delivery-plan.md), [architecture](docs/architecture.md), and [domain glossary](GLOSSARY.md).

For implementation, read the [technical specifications and agent work orders](docs/technical/README.md), including [shared schemas and fixtures](contracts/README.md).

Track implementation in [GitHub Issues](https://github.com/0x63616c/folding/issues) and the [work tracker](docs/work-tracker.md).

## Planning documents

- [Product requirements](docs/product-requirements.md): agreed scope, user experience, and launch languages.
- [Tracking and data](docs/tracking-and-data.md): event semantics, sync, export, reset, and device experiments.
- [Competition and operations](docs/competition-and-operations.md): leaderboards, security, notifications, and administration.
- [Engineering and release](docs/engineering-and-release.md): native design, testing, infrastructure, localization, and App Store automation.
- [Decisions before building](docs/open-decisions.md): unresolved choices, feasibility gates, and proposed defaults.
- [Research references](docs/references.md): sources consulted and limits of the research.

## How to read the requirements

**Agreed** means explicitly requested or accepted by the owner. **Proposed** means a recommendation discussed but not yet explicitly adopted. **Unverified** means platform behavior or tooling needs evidence before becoming a product promise.

These documents consolidate the planning conversation through November 7, 2026. Account/project setup and login are authorized now that the name is chosen. Full implementation/shipping is now authorized. Additional purchases still require a specified budget.

## Local development

Run `scripts/bootstrap` to prepare the contract validator and shared repository hooks, then
`scripts/check` for contracts, personal core, localization and formatting. `scripts/format`
formats owned Swift and OpenTofu files without staging them. Use `scripts/check-backend`
for the Worker and `bundle exec fastlane ios verify_app` for native simulator checks; root
Folding CI selects these independently.

## Monorepo automation

Run product commands from `apps/folding`. The central CI workflow selects Folding checks
from changed inputs. Core and presentation tests run on the host; affected native code is
compiled without booting a simulator. Production is the only app/backend environment.
See [release operations](fastlane/RELEASE.md) for TestFlight/Worker delivery and immutable retries.
