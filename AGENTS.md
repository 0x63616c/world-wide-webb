# Folding execution instructions

- Read `docs/review-spec.md`, the relevant `docs/technical/` contract, and the associated GitHub issue before implementing work.
- The owner authorized parallel implementation agents on November 7 to accelerate delivery. Use at most three subagents at a time. Assign separate file ownership, coordinate shared contracts through the primary agent, and integrate/review each batch. Older single-execution-agent wording is superseded.
- Only the primary agent accesses credentials or performs deployments. All `op` and secret-dependent commands reuse its persistent shell; delegated agents must never independently call `op` or trigger authorization prompts. Independent reviewers remain read-only.
- Build in substantial batches. Run focused checks for newly introduced risks and the required checks at batch boundaries.

## Keep completion tracking current

- GitHub Issues in `0x63616c/folding` are the live work tracker; `docs/work-tracker.md` is its repository summary.
- Track concrete deliverables as linked sub-issues under the original work orders. Keep each deliverable’s issue state/status label and GitHub Project Status consistent: Next, In progress, Blocked, Deferred, or Done. A verified local component may be Done while its broader live-integration parent remains open; state that scope explicitly. Never present ticket-count percentage as an effort-weighted shipping percentage.
- Tick individual issue checklist items as soon as their work is completed and verified. Update the issue body, not only progress comments. Split broad items into concrete subitems when only part is complete; preserve every original requirement.
- Link the implementing commit and relevant test/deployment evidence. Distinguish implemented, verified, deferred and blocked work; do not tick unverified acceptance criteria.
- At each batch checkpoint, reconcile the issue checklist and repository tracker with actual results. Do not leave verified work unchecked or finished issues open.
- Close an issue only when all its acceptance criteria are satisfied. Then tick its corresponding entry in `docs/work-tracker.md`. Deferred requirements must remain explicitly tracked in the designated follow-up issue.
- Physical-device checks are owner-approved deferrals to F13 after App Store submission. Mark them deferred, never passed. The full shipping goal remains incomplete until those checks and any resulting fixes are done.

## Operations

- Use OpenTofu for supported infrastructure and Fastlane for Apple release automation. Use the ChatGPT browser only for necessary account/bootstrap steps; do not use Safari.
- Reuse the primary agent's persistent shell for 1Password and secret-dependent commands, following global instructions. Keep secrets out of Git, logs and agent messages.
