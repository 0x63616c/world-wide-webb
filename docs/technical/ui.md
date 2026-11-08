# Native UI implementation specification

Status: implementation defaults for v1. Read [the product specification](../review-spec.md) first. This file determines presentation and UI-state ownership; storage, security, and competition contracts determine the facts displayed. Device-specific hinge APIs, Shortcuts labels, and handoff behavior remain explicit M1 checks, not invented guarantees.

## 1. Constructs and ownership

Use SwiftUI and Observation. The app composition root creates the production data/competition dependencies and passes them to feature models; no view creates a database connection or network client. Feature models with async work are `@MainActor @Observable` reference types. Views own those models with `@State`; use `@Bindable` only where controls actually edit model state. Simple presentation rows are value views, not separate view-model classes. Use `Task` cancellation and request identity to prevent a slow response for a previous period from replacing the current period.

Use immutable, `Sendable` read models across concurrency seams. The SQLite/App Group journal and the Core Data CloudKit replication mirror stay behind FoldingData. No `@FetchRequest`, managed object, raw SQL, or CloudKit record reaches a screen. UserDefaults is only for small preferences, not events, session state, reset ordering, or authoritative counters. Prefer async functions and a bounded observation stream over a global notification bus.

Feature models own these operations:

- `SetupModel`: load durable setup progress, start/cancel test attempts, observe committed test receipts, finish setup. It does not determine whether an event counts.
- `TodayModel`: observe personal summary and local sync status; edit summary preferences.
- `HistoryModel`: select interval/day, request summary/session pages, cancel outdated queries.
- `CompetitionModel`: select leaderboard period, fetch accepted results, paginate, observe account/transfer/upload state. It never adds pending folds to public scores.
- `SettingsModel`: read/write preferences and call explicit export/reset/leave/delete operations. Destructive operations are commands with progress/results, not mutations to a local total.

Use a small generic presentation state only for independently loaded remote content: `idle`, `loading(previousValue?)`, `loaded(value)`, `failed(previousValue?, error)`. Account restriction, setup progress, reset state, and upload state have separate typed states; never compress them into `isLoading`/`hasError` booleans.

## 2. App shell and navigation

Use one native `TabView`: Today (`chart.bar`), History (`clock`), Leaderboard (`trophy`). Keep tab text visible. Each tab owns a `NavigationStack` and typed route enum; selecting another tab preserves its navigation stack. Do not build a floating custom tab bar.

Settings is a gear toolbar button on each tab's root. Present a sheet containing a `NavigationStack`, native `Form`, and Done toolbar action. Permit one modal at a time through a typed `PresentedSheet` enum; nested settings destinations push inside that sheet. Editing summary, account profile, export format, notification options, and share previews use their own sheets/destinations as specified below. Use native alert/confirmation dialog for simple destructive confirmation and an explicit operation-progress view when the command lasts beyond dismissal.

First launch presents setup as a full-screen flow. A short “Not now” action returns to Today with one “Set up tracking” row. It does not falsely mark setup complete. Later widget/deep-link navigation opens the selected destination, then shows required setup/account state within it; never discard the link because setup was incomplete.

Internal URLs use a small allowlist: `folding://today`, `folding://history?date=YYYY-MM-DD`, `folding://leaderboard?period=week|month|all`, and `folding://results?period_id=…`. Parse and validate parameters; invalid dates/IDs fall back to the destination root. A URL never authorizes a reset, purchase, account action, or upload. Public universal links, if implemented, must use separately configured associated domains; do not assume the custom scheme provides them.

## 3. Layout and appearance defaults

Use system semantic colors, dynamic text styles, native grouped backgrounds, and safe areas. Tint is automatically black in light mode and white in dark mode; there is no accent setting. Accent colors do not recolor primary body text or imply status without a label/icon.

Appearance preference is `system`, `light`, or `dark`; apply the optional `preferredColorScheme` at the app scene/sheet root. Widget appearance remains system controlled. Store appearance, ordered summary metrics, home timezone, and threshold preferences through a versioned settings interface; produce an App Group-readable widget preference snapshot.

Start with a spacing scale of 4, 8, 12, 16, 24, and 32 points. Use 16-point compact content margins and a centered content width capped at 720 points on larger layouts. Summary sections can use two columns when effective content width is at least 600 points and Dynamic Type is below accessibility sizes; otherwise use one column. Preserve reading order across reflow. Do not infer inner/outer display from hard-coded phone model names or fixed pixel dimensions.

Use native navigation bars, tab bars, sheets, menus, pickers, buttons, and chart controls. Let standard system controls adopt Liquid Glass. Do not put custom glass behind every statistic, add decorative blurred cards, or draw imitation system buttons. Any custom material requires a demonstrated readability benefit in the rendered review. Apple's material guidance treats glass as a controls/navigation surface; the precise rendering follows the OS and accessibility settings. [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)

Today value cards share a 108-point minimum height; active duration stays inside its card and large accessibility text may expand the layout. Chart bars and labels use identical ordinal bin positions, with aligned axis marks and no label-induced mark offsets.

No decorative gradient is required. No mascot, gamified streak counter, achievement feed, or custom chart engine is part of v1.

## 4. Guided setup: durable state machine

Persist `SetupProgress` locally with `flowID`, schema version, tracking device ID, data generation, step, last successful open/close test receipt IDs, and completion date. It is device-specific: sync must not mark a replacement phone's automations tested. Settings “Run setup again” creates a new flow; it does not erase the previous successful-test record until replaced or erase history.

States and permitted transitions:

1. `welcome` → Continue → `openingInstructions`.
2. `openingInstructions` → Open Shortcuts stays in this state while leaving the app; Continue → `openingReady` after the user confirms configuration.
3. `openingReady` → Test → `awaitingOpening(attemptID)` after the data layer commits a test lease; cancel → `openingReady`.
4. `awaitingOpening` → matching committed receipt → `openingPassed`; expired/failed attempt → `openingRetry`; app backgrounding alone does not cancel an active lease.
5. `openingPassed` → Continue → `closingInstructions`.
6. `closingInstructions` → Open Shortcuts stays in this state; Continue → `closingReady`.
7. `closingReady` → Test → `awaitingClosing(attemptID)`; cancel → `closingReady`.
8. `awaitingClosing` → matching committed receipt → `closingPassed`; expired/failed attempt → `closingRetry`.
9. `closingPassed` → Continue → `complete`; Done dismisses to Today.
10. Retry returns to the relevant Ready state and creates a new attempt only after Test is pressed. Back/cancel invalidates any outstanding lease before changing the expected step. Leaving setup clears an active lease and preserves completed progress.

On app activation, reload durable progress and the attempt receipt before showing a retry. A committed receipt received while the app was suspended must still advance the flow. A launch never fabricates success based on the phone's current physical pose. If the flow's device/generation no longer matches, cancel the attempt and return to the relevant Ready state.

### Test correlation contract

The UI requests a 120-second test lease from FoldingData containing attempt ID, expected transition (`open` or `close`), current tracking device and generation, and the current sequence watermark. Only one lease can be active per device. The data layer consumes it atomically for the first matching new event after the watermark, within the lease window; that event records the attempt ID and setup-test status. Opposite transitions do not consume the lease and remain ordinary events. Duplicate delivery cannot consume a second lease or advance a second step. The test receipt proves intent delivery/commit, not whether the reducer awarded a fold.

Setup-test events are excluded from personal and competition statistics by the recording/domain rules, not later subtracted in the UI. The UI accepts success only for its current attempt ID/device/generation and expected transition. Expired leases cannot suppress future ordinary events. Cancelling a lease does not retroactively turn a committed test into a scored fold. The installed Shortcut action must not contain a permanent “test mode” argument. Test receipt/session interaction is owned by the tracking contract; the screen does not patch reducer state.

The 120-second window is a product default, not a promise that iOS grants background execution for that duration. The screen shows a small waiting indicator and “Open your Duo”/“Close your Duo”; on expiration use “No event yet” with Retry and Check setup. Never auto-retry indefinitely or ask the user to fold repeatedly without an active attempt.

### Setup content and animation

Each instruction screen has a short title, one actionable sentence, a simple two-panel device illustration, and one primary action. Put additional instructions in an expandable “Help” section. The Shortcuts instructions must come from a verified per-OS/per-locale guide; no invented automation names or URL paths. Use supported handoff only, and show manual instructions when a deep link cannot reach the desired page.

Animate the device illustration once on entry and after a successful test, using native SwiftUI transforms. Suggested transition duration: 0.25 seconds; illustrative opening motion: 0.8 seconds. Respect Reduce Motion with a static end pose and brief opacity change. Do not animate continuous physical angle unless an available, tested foreground API supplies it. Never use animation state as tracking input. [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion)

## 5. Today

Reading order: large title; optional actionable status row; today's fold total with label; time unfolded; seven-day trend; optional selected metrics. Use `.largeTitle`/`.title`-scaled system typography and monospaced digits for changing numbers, never fixed fonts that break large text. Native scroll container handles smaller displays.

The default summary contains folds, time unfolded, and seven-day trend. “Edit Summary” opens a native list with enabled metrics and reorder handles. Keep folds visible; allow time unfolded, trend, opens, closes, cycles, lifetime folds, equivalent travel, and competition comparison to be selected/reordered. Competition comparison is absent before joining. Persist metric identifiers, not translated labels or view indices.

Display local personal totals immediately. A running session is a live presentation of the domain's session snapshot, with duration formatting chosen by elapsed time; refreshing the display must not persist timer ticks. Show uncertainty with a compact symbol and “Incomplete” in session details rather than counting uncertain time as final.

Zero folds after tested setup is a valid value, not an error. Before setup, show zero with the setup action. Show at most one compact status row by priority: action required (setup/account/storage), reset pending, then upload pending. Other details belong in Settings → Tracking/Sync. Do not show a permanent healthy-sync banner. CloudKit sync and competition uploads must have distinct detail labels.

## 6. History

Use a native segmented picker for Day / Week / Month / All. Below it, show the selected interval and previous/next controls. Day uses hourly fold bars; Week daily bars; Month daily bars; All uses monthly bars. The data layer supplies bins and totals; the view does not rebucket UTC timestamps itself. Empty bins represent zero only when history coverage is known, otherwise indicate missing/incomplete coverage in the detail view.

Use Swift Charts `Chart` with `BarMark`, native axis formatting, and selection supported by the pinned SDK. Selecting a bin shows its date/time and count without requiring color interpretation. Provide a textual summary and accessible data values; do not make chart scrubbing the only way to reach a day. Follow the chart with daily/session list rows and drill-down via typed navigation.

Session detail shows start, end or running state, time unfolded, and completeness. Equivalent travel appears only if enabled, labeled “Equivalent travel,” with the short optional info sheet from the spec. No health/wear score or angle precision beyond the documented estimate.

## 7. Leaderboard, profile, and results

Before opt-in, show a short competition description and the system Sign in with Apple control. Do not request it during tracking setup. Cache Apple's one-time name response in device-only storage before the server exchange, keyed to the Apple identity; do not reuse it across identities, and clear it after confirmed account deletion. After sign-in, present suggested nickname, an explicitly labeled optional photo picker (Apple provides no profile photo), and Join confirmation; cancellation leaves private tracking unaffected. Disable duplicate Join submissions while one command is pending.

Use a native segmented picker: Week / Month / All Time. The header shows period/date range and an info button; UTC belongs only in details or a compact label where necessary. Never print backend rules above the list. Show a compact podium of the first three distinct medal ranks that exist, then the ranked list. Tie groups may contain more people than available podium space: show a representative avatar plus a “+N” affordance that opens the tied group. Every tied entrant receives the correct rank/crown in the list; never silently break ties to fill three slots.

Rows contain numerical rank, avatar, nickname, fold total, and optional crown. Crown rendering uses gold/silver/bronze asset variants plus accessible “Gold/Silver/Bronze” values. Public score is server accepted folds; pending uploads appear separately as “N pending” in the user's status, never optimistically added. Pin the user's position with `safeAreaInset` where it does not obscure rows or tab controls. Hide the pinned row when not eligible; show a concise reason in the account detail when needed.

A leaderboard failure with cached results keeps those results visible and offers Retry with an updated timestamp in details. An initial failure shows a compact error state. Empty periods show “No folds yet”; comparison below the minimum population follows the spec. Banned users see the restriction and appeal/account actions, not a fake empty leaderboard.

Profile uses a native form and `PhotosPicker` for avatar selection. Decode/crop locally for preview, then upload through the protected backend command. Display the sanitized image after processing; names/photos do not wait for admin approval. Failed uploads retain the draft for retry without replacing the public image. Reporting and retrospective admin removal/ban controls handle abuse.

Your Results lists finalized week/month summaries with period, rank, score, and medal. Selecting one opens the stored result detail, not a recomputation from current profile totals. Sharing opens a preview rendered from a specific result/version, followed by the native share sheet. Never automatically share or include tokens/internal moderation status. Report and Hide/Block appear in a row menu and use confirmation only when useful; hiding never renumbers remaining ranks.

## 8. Settings, destructive actions, and notifications

Use native grouped Form sections in this order: Appearance; Today; Tracking; Notifications; Competition (if joined); Data; Support. Appearance holds System/Light/Dark only. Tracking holds setup/test status, last event, Run setup again, home timezone, tracking phone, and daily limit. Data holds Export and Reset history. Support holds tip jar, contact, privacy, and version/build.

Daily limit defaults to 100 folds with alerts off; changing the value does not enable notifications. Weekly and monthly settings are native pickers with Off / All results / Podium only. On the first enable action, request system permission; a denied result leaves the preference off and offers an Open Settings action. Do not repeatedly request permission on every foreground. If permission is later revoked, preserve the chosen category but display “Notifications off” with a settings link.

Export asks CSV or JSON, shows progress if needed, then presents a system share sheet for the completed file. Do not materialize the entire history on the main actor or upload the export to generate a link. Clean temporary exported files using the storage contract's retention policy.

Reset history uses a concise confirmation: title “Reset history?”, body “Deletes your history, leaderboard scores, and medals.” Actions Cancel / Reset History (destructive). On successful local reset, immediately render the new generation's empty personal summary and compact “Cloud reset pending” if required. Never show success before the durable reset marker is committed.

Leave competition and Delete competition account are separate commands. Leave preserves private history and removes public participation; deletion also removes the competition profile/credentials according to the backend contract. Both require clear confirmation. Deletion can offer a separate, default-off private-history reset choice; do not silently couple them. Failed remote removal stays visibly pending with retry, not an apparently deleted account whose public data remains undisclosed.

The tip jar uses StoreKit product metadata for actual localized prices; three unobtrusive buttons, no unlock claims or prompts elsewhere. Purchase progress/cancellation are local to that screen. The review prompt uses the system request mechanism only at the spec's eligibility point, and no satisfaction question.

## 9. Widgets

Use `AppIntentConfiguration` with a `WidgetConfigurationIntent` metric enum and `AppIntentTimelineProvider`. Declare only `.systemSmall`, `.systemMedium`, `.accessoryRectangular`, and `.accessoryCircular`. Configurations are per widget, not one global selection. [Apple configuration reference](https://developer.apple.com/documentation/widgetkit/appintentconfiguration)

Supported combinations:

- Small: folds, time unfolded, or daily-limit progress; one primary value.
- Medium: folds, time unfolded, daily-limit progress, or seven-day trend; optional supporting label/value where space permits.
- Rectangular Lock Screen: folds, time unfolded, or daily-limit progress; one compact value/label, no chart.
- Circular Lock Screen: folds or daily-limit progress; no duration text or weekly chart squeezed into the circle.

Filter unsupported configuration choices for each widget kind/family using the actual supported SDK facilities. If a saved metric becomes unsupported after an update, render folds and allow reconfiguration; never crash or silently show another metric under the wrong label. Daily-limit progress displays a bounded gauge with the actual count and never stops recording at 100%.

Read one immutable snapshot from the App Group data interface. Include data timestamp, selected metric values, theme preference, and optional running-session anchor. Providers must not query the leaderboard, run CloudKit reconciliation, or mutate tracking state. Use system timer presentation for a valid running anchor only where supported and verified; otherwise display snapshot duration. Request timeline reload after relevant committed changes, without promising immediate redraw or scheduling per-second refreshes.

Adapt to `widgetRenderingMode` and system tint/monochrome treatment; render accent only when permitted and retain non-color meaning. App light/dark overrides do not override Lock Screen appearance. Use system container backgrounds appropriate to the family. [Apple rendering guidance](https://developer.apple.com/documentation/widgetkit/preparing-widgets-for-additional-contexts-and-appearances)

Use `widgetURL`/supported links for the allowlisted internal destinations. No “add fold” button, reset control, or manual-score interaction. Placeholder/gallery data is deterministic sample data and never written to real history. After a reset, invalidate relevant widget snapshots; stale system-rendered snapshots may persist temporarily and must not restore data.

## 10. Localization and visual acceptance gates

String Catalog keys are stable semantic identifiers with translator context. Use localized number/date/duration formatting and plural rules; do not concatenate translated fragments or use English display text as data identifiers. Launch resources include English, German, French, Spanish (Spain and Latin America), Japanese, Korean, Brazilian Portuguese, Simplified Chinese, and Traditional Chinese. OS/App Store locale mapping is owned by release configuration; UI uses supported bundle localizations and the system's per-app language preference.

Every user-facing string includes accessibility labels, notifications, widget configuration, App Intent titles/parameters, error messages, chart values, purchase state, setup instructions, and destructive confirmations. Exact system-control names must match the tested OS locale; do not AI-invent Shortcuts labels. Server errors map to local keys; never display raw server messages or stack traces.

Independent review must inspect these rendered fixtures at both supported display widths, light/dark, default and largest accessibility text, and representative long/CJK translations:

- First launch, interrupted setup, waiting/retry/success, and rerun setup.
- Today with zero, ordinary, large counts, active/incomplete sessions, cloud reset pending, and uploads pending.
- History with sparse data, DST boundary, missing events, and large history.
- Leaderboard before join, loading/failure/cache, tied podium, own rank offscreen, pending avatar, banned account, and finalized results/share preview.
- Settings, permission denial, purchase cancellation, export, reset, leave, and account deletion.
- All four widget families in supported rendering modes, configured metrics, and reset/empty states.

Acceptance: no clipped controls, overlapping crowns, inaccessible touch targets, chart-only facts, color-only statuses, or scrolling traps. Aim for at least 44×44-point interactive targets. Every icon-only action has a clear VoiceOver label; logical focus order follows visible reading order and setup success is announced once. Reduce Motion produces no required rotating/folding motion; no information disappears when animation is disabled.

Copy review is a release gate: delete introductory filler, technical banners, repeated descriptions, and unnecessary confirmations. Keep one primary action per setup step. Retain words for ambiguous icons and destructive actions. The presence of detailed explanation in this file is never permission to paste it into the app.

## 11. Known agent mistakes to reject

- Views updating counters directly or treating `@MainActor` as cross-process storage protection.
- Network completion from a previous leaderboard period replacing the current screen.
- A Boolean collection for onboarding instead of the durable state machine.
- Marking setup successful just because Shortcuts opened or the phone looks open.
- Permanently installing a test-mode Shortcut or tagging all events during setup as tests.
- Discarding history or re-enabling notification permissions when users rerun setup.
- Presenting pending folds as accepted public scores, or assigning unique ranks to tied scores.
- Building custom glass controls/tab bars because native controls seem too plain.
- Assuming accent/light/dark preferences override WidgetKit system rendering.
- Inventing Duo SDK symbols, hinge triggers, deep links, screenshot dimensions, or localized system labels.
- Treating screenshots with fixtures as proof that physical triggers, iCloud, purchases, or push work.

## Reference checks

The implementation must compile against the pinned SDK and test actual platform behavior. References below establish available constructs; they do not verify Folding's integration:

- [SwiftUI model data](https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app) and [navigation stack](https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack).
- [Widget families](https://developer.apple.com/documentation/widgetkit/widgetfamily/) and [widget rendering modes](https://developer.apple.com/documentation/widgetkit/widgetrenderingmode).
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

## November 8 owner refinements

SF Rounded is inherited by app-owned views and widgets. Cards share a 20-point
radius and stat content uses 20-point insets and a 72-point minimum content
height. Dynamic Type may expand cards. Today cards use stable metric IDs for
drag/drop; the editor supplies native reorder controls. Saved retired travel
metrics are discarded without resetting appearance, timezone or the daily limit.

The foreground duration uses a one-second presentation timer and adds the valid
running interval to the completed daily duration. A lightweight journal revision
observer refreshes after events written by another app process; timer ticks never
create tracking events. History uses ordinal bar positions and matching axis
anchors. Month selection formats the selected bin start with full month/day in
the saved home timezone and environment locale. Period navigation is bounded by
retained data; the session list has a bounded independent scroll area. Patterns
count the analytics counted-event IDs exactly once by local hour, weekday and
month day.

Only incomplete session details offer Delete. Confirmation commits a durable
local tombstone before the row disappears. Widgets, export and personal summaries
refresh immediately; pending leaderboard removal is visible until acknowledged.
Signed-out weekly/monthly notification controls are disabled, and the controller
rejects result preference changes before permission or network calls. Daily-limit
alerts remain available locally. Switches use a black track and contrasting thumb;
only successful Shortcuts status ticks are green.

Join uses Apple-provided/cached name suggestions when available, an explicit photo
picker, a labeled name field and Join confirmation. Authenticated unjoined users
resume review without repeating Apple authorization. Apple provides no profile
photo. Tip thanks/confetti only follow verified matching consumable transactions;
recovery of old unfinished tips does not trigger celebration, and Reduce Motion
keeps static thanks.
