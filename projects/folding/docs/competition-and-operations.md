# Competition and operations

> Historical planning notes. The consolidated [v1 review specification](review-spec.md) supersedes proposals and unresolved choices below. Retained for rationale and traceability.

## Agreed direction

Personal tracking comes first; competition is opt-in. Use Sign in with Apple for joining competition, App Attest for integrity checks, and a Cloudflare-backed service managed as code. Game Center was evaluated but is not the current preferred direction.

Show this week, this month, and all-time leaderboards with a gold/silver/bronze treatment. Show the user's historical weekly/monthly placements inside the app. Users can opt into results and podium notifications and choose notification categories.

## Proposed competition rules — awaiting final agreement

- Score deduplicated recorded folds; server computes totals rather than trusting uploaded totals.
- One competition profile per Apple identity, using a separate public nickname.
- Use common UTC boundaries: Monday at 00:00 for weeks and calendar-month boundaries for months.
- Show period end times/countdowns locally; personal daily statistics can use local reporting rules.
- Equal scores share ranks and medals. Confirm whether this allows multiple gold recipients and skipped positions.
- Save finalized period results: rank, score, participant count, percentile, medal, and rules version.
- Retain correction history when moderation changes results.
- Keep all-time ranking live; decide whether historic period totals contribute after resets.

**Agreed:** accept late uploads for 24 hours after a weekly/monthly period ends, then finalize results and send notifications. Exact timestamp validation and treatment of later events remain to be specified. Events outside competition eligibility must not be lost from personal history.

## Percentiles

Percentiles are required, but the comparison population and tie formula are not decided.

Earlier proposal: compare the last seven complete days among opted-in users with tracking set up throughout that interval; include zero-fold days and a new-user eligibility period. This differs from calendar-week podium ranking. Decide whether to retain that separate comparison or derive percentile directly from the selected leaderboard period.

Label population and period clearly; show participant count. Do not imply comparison against all Duo owners. Decide minimum sample size and the definition of an eligible/active participant.

## Integrity and moderation

App Attest verifies app-installation/request integrity, not physical hinge movement. A legitimate Shortcut action may still be invoked artificially. The objective is layered abuse resistance without punishing ordinary offline use.

**Proposed defenses:**

- Validate Sign in with Apple tokens server-side and bind app installations to accounts.
- Verify App Attest attestation and assertions, including challenges, payload binding, and replay protection.
- Assign stable event identifiers and deduplicate retries across all ingestion paths.
- Validate timestamps, sequences, and reset generation; calculate scores server-side.
- Rate-limit accounts/installations and apply transport-level protections.
- Flag implausible rates and sustained patterns. A batch arriving after an offline interval is not itself proof of abuse.
- Quarantine suspicious competition submissions for review rather than immediately imposing permanent bans.
- Investigate whether current hinge state can corroborate events without assuming it proves their origin.
- Keep personal tracking available when competition is restricted.

Define behavior when App Attest is temporarily unavailable, unsupported, or running in a different execution context. Development fixtures must never be accepted by production. App extensions have App Attest limitations, so validate where intent logging and later submission occur.

Reset should not erase a ban. A privacy-conscious moderation retention policy, appeal/contact path, and account-deletion behavior still need decisions.

## Admin interface

**Agreed:** a small management UI at an admin subdomain behind Cloudflare login/access protection, with the ability to ban abusive participants.

**Proposed:** Cloudflare Access with an explicit admin allowlist and strong identity-provider authentication. Validate Access JWTs and admin authorization in the API as well as protecting the UI. Prevent alternate API routes from bypassing protection.

Initial tools: participant search, suspicious-submission queue, evidence view, exclude/reinstate scores, temporary suspension, ban/unban with reasons, result/medal correction, and audit log. Every mutation records actor, time, reason, and affected scope. Define admin roles and access list before deployment.

## Notifications

**Agreed:** user-configurable notification choices; daily threshold alerts; opt-in podium and other final-placement results.

**Proposed categories:** daily limit, weekly results, monthly results, and podium awards. Combine overlapping award/result messages. Request OS permission in context when a user enables a feature.

Use local notifications for the threshold where supported and server-triggered APNs for finalized competition outcomes. Send each result once, honor preferences at delivery time, manage revoked/rotated push tokens, and specify quiet hours/timezone handling. Exact delivery semantics need validation.

The daily threshold is a personal reminder, not an enforced block on tracking. A once-per-local-day alert is proposed. Copy should remain simple and avoid unnecessary warnings.
