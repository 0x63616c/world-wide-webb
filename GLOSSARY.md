# Folding domain glossary

Use these terms consistently in code, contracts, tests, and documentation. The [specification](docs/review-spec.md) defines the complete behavior.

- **Event:** immutable observation submitted by a tracking source. It has a stable identifier, source device, data generation, observation time, transition, and setup-test status. Receiving an event does not automatically award a fold.
- **Fold:** one accepted opening or closing transition. An open followed by a close normally produces two folds.
- **Retry:** another delivery of the same event identifier; it produces no additional effect.
- **Repeated state:** a distinct event reporting the already-observed state. It adds no fold and may mark a session uncertain.
- **Cycle:** a complete, sufficiently observed open–close sequence. It is a statistic, not an extra fold.
- **Session:** the interval represented by an open and its subsequent close, with completeness/uncertainty recorded explicitly.
- **Time unfolded:** duration from valid sessions, split at the user's home calendar boundaries. A running estimate is distinct from a finalized duration.
- **Equivalent travel:** the optional reference distance/rotation derived from folds. It is not measured movement or hinge wear.
- **Tracking phone:** the currently selected source device. Competition accepts eligible events from one active phone at a time.
- **Home timezone:** the stable timezone used for personal days, thresholds, and notifications; independent of UTC competition periods.
- **Data generation:** event namespace created by reset. Old generations cannot restore cleared history.
- **Reset marker:** durable ordering record selecting the current generation, separate from event cleanup.
- **Pending upload:** locally committed competition event awaiting verified backend acceptance. It is not yet a public score.
- **Participant:** a user who has opted into competition and has a server-recognized identity.
- **Submission:** a batch of candidate competition events. Authentication/attestation verifies its origin/integrity, not physical folding.
- **Accepted fold:** a fold that passes competition eligibility and validation and contributes to a public score.
- **Quarantined submission:** retained for moderation but excluded from accepted totals until approved.
- **Period:** a UTC week or month; All Time is an aggregate rather than a finalizing calendar period.
- **Cutoff:** the server receipt deadline for a period's late submissions.
- **Finalized result:** versioned rank, score, participant count, comparison, and medal after the period's processing is complete.
- **Correction:** explicit audited amendment of finalized results; never an incidental effect of a late upload.
- **Community ban:** server-enforced loss of competition participation, not a lockout from private tracking or deletion.
- **Tip:** an optional consumable purchase with no feature unlock or competitive effect.
