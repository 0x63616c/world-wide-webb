# Owner polish, history and private badge follow-up — November 8

Main-scoped deliverables: #76, #77 and #78, under #71/#8. This batch does not deploy the Worker/site, apply live migrations, change provider capabilities or distribute TestFlight.

## Requested behavior

- Six bundled AI-generated colorful flat badges, with a modest copper/green starter and visibly richer silver/blue, gold/purple and gold/red fold tiers. Day awards use silver/turquoise and gold/orange calendars. Original vectors are preserved in `design/badges/legacy`; exact generation/edit prompts and asset paths are recorded in `design/badges/generation-prompts.json`.
- Remove Next milestones headings, the Milestones info button, the visible Today Edit Summary button, Time unfolded's timer icon, and routine pending-fold counts in Today/Settings. Summary editing remains in Settings and the card context menu.
- Darker shared page/card surfaces; one SummaryCard container and one label/value style for folds, opens, closes, cycles and all-time folds. At 600 points or wider, cards occupy two columns, including Folds and Time unfolded together by default; an odd final card keeps half width. Accessibility text sizes stack cards.
- Elapsed time uses localized narrow units, omits zero units and supports days: `4h 3m 2s`, `3d 3h 1m 3s`, `0s`.
- The leaderboard's spinner occupies list content instead of covering the period picker. List avatars share gold/silver/bronze podium rings, with gold sparkle and static Reduce Motion fallback. Vacant podium places have placeholders; podium photos open profiles without a disclosure arrow.
- Optional local phone labels are persisted by device UUID, retain This iPhone identification and do not rename the Apple device or sync through iCloud. The naming prompt states this scope.
- Tap your own photo/name to edit directly. Photo selection shares bounded decoding/crop preparation, retains retry/cancel and fences identity changes. Settings retains account deletion. Remove featuring controls and all member-visible badge artwork/collections.

## Service contracts

`GET /v1/participants/{id}` retains compatible empty `earned_badges` and null `featured_badge_id` fields. Live/finalized board projections return null featured badges. `PATCH /v1/profile/badge` returns authenticated 404 while featuring is paused. Stored legacy selections remain private; owners retain grants/progress and grouped unlock acknowledgment.

`POST /v1/history-batches` uses the existing EventBatch envelope, current active caller epoch and `submit_events` attestation purpose. Imported original events retain their ID, source/sequence, generation, timestamps and null competition epoch. Only current-generation non-test activity strictly before the original join boundary is eligible. Live/post-transfer epoch rules remain unchanged. Immutable identities, replay receipts, authoritative reduction, deletion tombstones and participant/session/generation/revision guards remain shared with normal ingestion. Open periods update using original observation times; finalized periods are not reopened.

Optional `enrollment.history_import_before_ms` activates bounded durable client work for new/existing accounts. Older services omit it, leaving import inactive. The queue observes selected-source watermarks, excludes setup/quarantined/deleted records and discovers late mirror arrivals. Rollback to an older service disables queued history work without altering original events. Deleting an imported incomplete entry queues a public tombstone under an owned current epoch.

Preferences add optional `badge_earned:bool`, default false. Migration `0022_badge_notifications.sql` adds private consent and delivery bookkeeping. New confirmed grants enqueue in the scoring transaction; enabling notifications suppresses the existing collection. Up to six pending awards share a persisted delivery ID and stable APNs identifiers. Delivery rechecks consent, current owner/generation/grants, active installation/session, token binding, acknowledgments and operational pause controls. Retries and invalid-token/provider handling reuse the APNs transport. Acknowledgment/opt-out suppress pending jobs; reset/account deletion clears them. Payloads route only to the named owner's Milestones screen. Foreground remote delivery refreshes the existing in-app celebration without a duplicate banner.

`events.history_import` and `notifications.badges` are implemented capability names. Internal preview/full release preflight now requires both plus `profiles.milestones` and exact service source. Do not advertise the new capabilities until live acceptance.

## Verification

- Unsigned generic-simulator build-for-testing compiles app, widget and test targets without booting a simulator.
- Native source harnesses pass preference migration/persistence/identity isolation, narrow/wide/accessibility layout, day/hour/minute/second formatting and private badge-route validation.
- Focused client history checks pass: 41 original history records plus 18 live records; immutable null epochs; durable retries; bounded 256/44 pages; service rollback; reset fencing; selected-source watermarks; late mirror arrivals; and public deletion tombstones.
- Actual local Worker/D1 regressions pass the exact 18 + 41 = 59 example, immutable conflict and duplicate/lost-response handling, private member projections, disabled featuring, and opt-in/grouped/acknowledged badge notification queues.
- Six PNGs have transparent corners and near-opaque interiors; original rendering preserves their colors. Generation tool output was inspected directly.
- Final checks pass: 113 core tests; 29 actual Worker/D1 runtime tests; 232 semantic keys across ten locales; ten localization regressions; seven release regressions with 21 assertions; and the generic simulator app/test-target build. Earlier runtime harness migration omissions and Swift formatting violations were corrected before merge.

Live provider/Apple APNs delivery, actual device notification taps/cropping, final visual/native-language review, CI, storefront, App Store submission and post-submission hardware checks remain deferred in #25/#46/#47 and the existing shipping tracker. Local tests do not mark those passed. No simulator was booted or Simulator.app opened for this batch.
