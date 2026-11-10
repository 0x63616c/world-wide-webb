# Folding execution instructions

- Owner resumed app UI implementation and internal TestFlight shipping on November 8, 2026. Penpot work is paused; preserve its workspace and existing iOS experiments. This supersedes the earlier design-review pause and does not mark deferred shipping checks passed.

- Read the relevant `docs/review-spec.md` / `docs/technical/` contract and the associated issue when the task has one; do not create ticket ceremony for a small change.
- For live integration changes, consult `docs/experiments/live-integration-2026-11-07.md` and `docs/deferred-shipping-work.md`, then inspect the provider state being changed. Follow the root simplicity/checking rules. Delegated reviews, including Astra, require an explicit user request. Preserve recorded shipping and device-check deferrals without making unrelated deferred checks prerequisites for ordinary app work.
- Only the primary agent accesses credentials or performs deployments. All `op` and secret-dependent commands reuse its persistent shell; delegated agents must never independently call `op` or trigger authorization prompts. Independent reviewers remain read-only.

The original `folding` repository was archived into private `github-archive` and deleted.
Old issue/PR references in product records are historical, not an active repository.

## Keep completion tracking current

- [Folding — Ship v1](https://github.com/users/0x63616c/projects/9) and GitHub Issues in `0x63616c/world-wide-webb` are the live work tracker; `docs/work-tracker.md` is its repository summary.
- For tracked work, update the existing issue/checklist and repository summary at the end of a useful batch; link the implementing commit and relevant result. Do not create a sub-issue or evidence packet for every small step.
- Distinguish implemented, verified, deferred and blocked work. Close completed issues; preserve unfinished requirements and material deferrals. Do not present ticket-count percentage as an effort-weighted shipping percentage.
- Physical-device checks are owner-approved deferrals to F13 after App Store submission. Mark them deferred, never passed. The full shipping goal remains incomplete until those checks and any resulting fixes are done.

## Operations

- For iOS screenshots, render the actual view directly with an XCTest snapshot (for example SwiftUI ImageRenderer) before considering UI automation. Do not open, boot or navigate the Simulator app just to capture a static screen. Use a simulator runtime only when required to execute iOS code/tests, and simulator UI interaction only for behavior that cannot be verified by direct rendering or tests.

- Use OpenTofu for supported infrastructure and Fastlane for Apple release automation. Use the ChatGPT browser only for necessary account/bootstrap steps; do not use Safari.
- Reuse the primary agent's persistent shell for 1Password and secret-dependent commands, following global instructions. Keep secrets out of Git, logs and agent messages.

- Product copy: state each point once. Prefer a short heading and clear action; omit repeated labels, obvious explanations, unsolicited data reassurance and filler. Keep instructions needed to act and the concrete consequences of destructive actions. Apply this across the app and all localizations.
