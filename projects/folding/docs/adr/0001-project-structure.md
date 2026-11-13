# ADR 0001: Small monorepo with shared tracking behavior

Date: November 7, 2026.
Status: initial implementation default, following the owner's requested architecture approach.

## Context

Folding must record consistently across the app and Shortcuts, display the same data in widgets, and independently validate competition in Rust. There is no application code yet. The owner wants a clean repository informed by Matt Pocock's module design principles, not a large framework assembled before the first fold works.

## Decision

Use `0x63616c/folding` as a private monorepo. Start with a shared Swift package containing deterministic domain and data/integration targets, plus ordinary app/widget targets. Start the backend with domain and Worker crates. Use domain-named folders within these modules before adding more packages/crates.

The recording module owns durable event acceptance and derived state; presentation callers do not orchestrate database steps. The backend independently computes competition results. Versioned schemas/fixtures keep the two language implementations aligned without a cross-language runtime bridge.

Use `GLOSSARY.md` for product terms and ADRs for consequential choices. Add abstractions when an actual second adapter or demonstrated caller complexity warrants them. Tests exercise caller-visible behavior, with real storage integration tests for concurrency and reset races.

## Consequences

There are few public interfaces to understand and fewer places to change counting rules. Persistence and Worker integration remain substantial modules, so maintain internal organization and visibility rather than splitting every operation into a pass-through layer. Cross-language parity needs ongoing fixture checks. Exact event ordering, persistence transactions, and runtime connectivity must be proven in the first implementation milestone.

## Revisit when

A module has independently evolving consumers, excessive rebuild cost, or demonstrated testing/maintenance friction that a new package would solve. Do not split solely because a folder has grown or to match a generic architecture diagram.
