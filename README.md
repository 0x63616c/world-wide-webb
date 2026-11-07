# Folding

A free, native iPhone Duo folding tracker: personal statistics, guided Shortcuts setup, iCloud sync, widgets, and optional competition.

**Status:** shipping goal active; account setup and implementation are now authorized. The Swift tracking domain, durable journal and private infrastructure-state bootstrap are implemented; the app, backend and release pipeline remain in progress. The owner selected **Folding** as the final product name. App Store name registration is pending. The owner has purchased **getfolding.app**. The private repository is [0x63616c/folding](https://github.com/0x63616c/folding).

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

Run `scripts/bootstrap` to prepare the contract validator and repository-local Git hooks, then `scripts/check` for implemented personal-core/contract checks. `scripts/format` formats owned Swift and OpenTofu files without staging them. These are initial checks; backend, simulator and release CI gates are still being added.
