---
name: planning-milestone
description: Use when planning or scoping a world-wide-webb platform migration milestone, especially tickets named "Scope M<N>: ...". Turns a rough Beads milestone epic into executable child issues with dependencies, acceptance criteria, TDD expectations, verification, rollback, and human-review checkpoints.
---

# Planning A Platform Milestone

Use this skill when a ticket asks you to scope, plan, or flesh out a platform migration milestone.

The scope ticket plans the milestone, creates executable Beads work, then stops. Do not implement product or platform changes in the same ticket.

## Required Outcome

The milestone must end with:

- an updated milestone epic design
- child implementation issues
- dependency links
- red-first expectations for code-changing child issues
- verification checks
- rollback or cutover notes
- human-review checkpoints for risky production changes

## First Steps

1. Run `bd prime`.
2. Read the scope ticket with `bd show <id>`.
3. Find and read the parent milestone epic.
4. Read `docs/platform/README.html`, `docs/platform/NORTH_STAR.html`, `docs/platform/MIGRATION_PLAN.html`, `CODEBASE_OVERVIEW.md`, and `AGENTS.md`.
5. Read the relevant platform docs and code paths for the milestone before writing the design.

## Investigation Guide

- Platform primitives: `infra/src/*`, `infra/program.ts`, package layout.
- Networking/TLS: `infra/cloudflare`, `infra/unifi`, `infra/src/certmanager.ts`, captive portal deploy paths.
- Data/backups: `infra/src/cnpg.ts`, `infra/src/crons.ts`, Drizzle schema, migration scripts.
- Product moves: `apps/*`, workspace packages, Dockerfiles, Tilt, CI workflows.
- iOS: Capacitor config, Fastlane, and GitHub Actions iOS workflows.

## Epic Design Template

Update the milestone epic `--design` with:

```text
## Goal
What this milestone makes true.

## Scope
What is included.

## Out Of Scope
What must not be solved here.

## Current State
Relevant files, deployed behavior, and constraints.

## Target State
What the repo and production should look like after this milestone.

## Work Breakdown
Ordered child issues, each with a one-sentence purpose.

## Dependencies
Which child issues block which others, and which external milestones must land first.

## TDD Structure
For every feature or bug child issue, name the failing test, story state, or reproducible check to write first. For chores and refactors, name the existing gate that protects behavior.

## Verification
Commands, tests, previews, smoke checks, screenshots, or production checks required.

## Rollback / Cutover
How to reverse, pause, or recover safely if production breaks.

## Human Review Checkpoints
Decisions or cutovers that require explicit approval before proceeding.

## Docs To Update
Docs, instructions, and runbooks that must change with implementation.
```

## Child Issue Rules

Create child issues that are shippable slices.

Each child issue must include:

- why it exists
- exact acceptance criteria
- red-first test/story/check expectation for code-changing work
- verification command or manual check
- dependency links
- rollback note for production-facing work

Avoid vague tickets like:

- `Do platform migration`
- `Clean up code`
- `Fix networking`

Prefer tickets like:

- `Add product app registry and derive namespace/resource names`
- `Issue cert-manager certificate for app--cp.worldwidewebb.co`
- `Prove Control Center Postgres dump restores into scratch CNPG cluster`

## Recommendations And Questions

If a decision is needed, always show a recommendation first and label it `Recommended`.

Ask only when the decision blocks the design or would change production risk. Otherwise, choose the right default and record it in the epic design.

## Risky Changes

Mark a human-review checkpoint before:

- production hostname cutover
- Cloudflare Access policy changes
- captive portal UniFi redirect changes
- database export, import, final snapshot, or restore
- iOS production URL changes
- repository rename
- destructive cleanup of old paths or resources

## Completion Criteria

The scope ticket is complete only when:

- the milestone epic design is updated
- child issues are created
- dependencies are wired
- risky checkpoints are marked
- implementation has not started in the scope ticket
- another agent can pick up any child issue without extra context
