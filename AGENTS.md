# Folding execution instructions

- Read `docs/review-spec.md`, the relevant `docs/technical/` contract, and the associated GitHub issue before implementing work.
- Use one execution agent. Independent agents may review; they do not implement changes or access credentials.
- Build in substantial batches. Run focused checks for newly introduced risks and the required checks at batch boundaries.

## Keep completion tracking current

- GitHub Issues in `0x63616c/folding` are the live work tracker; `docs/work-tracker.md` is its repository summary.
- Tick individual issue checklist items as soon as their work is completed and verified. Update the issue body, not only progress comments. Split broad items into concrete subitems when only part is complete; preserve every original requirement.
- Link the implementing commit and relevant test/deployment evidence. Distinguish implemented, verified, deferred and blocked work; do not tick unverified acceptance criteria.
- At each batch checkpoint, reconcile the issue checklist and repository tracker with actual results. Do not leave verified work unchecked or finished issues open.
- Close an issue only when all its acceptance criteria are satisfied. Then tick its corresponding entry in `docs/work-tracker.md`. Deferred requirements must remain explicitly tracked in the designated follow-up issue.
- Physical-device checks are owner-approved deferrals to F13 after App Store submission. Mark them deferred, never passed. The full shipping goal remains incomplete until those checks and any resulting fixes are done.

## Operations

- Use OpenTofu for supported infrastructure and Fastlane for Apple release automation. Use the ChatGPT browser only for necessary account/bootstrap steps; do not use Safari.
- Reuse the primary agent's persistent shell for 1Password and secret-dependent commands, following global instructions. Keep secrets out of Git, logs and agent messages.
