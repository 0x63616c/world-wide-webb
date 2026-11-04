# Blocker v1 — design review

Design only · iOS 27 target

Open [index.html](index.html) locally. It is the contact sheet and links to all 56 states, their standalone HTML and PNGs. Each screen embeds its CSS and SVG icons; nothing requires a server, font download or build tool. Screens are 402 × 874 logical points, rendered at 2× into 804 × 1748 PNGs. [Full contact sheet PNG](screenshots/contact-sheet.png).

“Blocker” is a working name. All app selections, times and usage numbers are synthetic fixtures. Browser renderings express hierarchy and intent; they are **not native screenshots or evidence that Screen Time enforcement works**. The Python and JavaScript files generate and capture design documents, not application code.

## Product decision

The job is to make one clear commitment before the next reflexive scroll. After that commitment, the phone should stop inviting negotiation. Pick a saved group, pick a length, review exactly what will happen, start. At the point of attempted opening, the shield supplies an end time and a way to leave. No motivational feed, score rings, earned rewards, account or setup questionnaire.

Three destinations: **Lock**, **Stats**, **Settings**. Only one lock can run at a time. All groups and mutable settings are read only during it, including unrelated groups. No editing, shortening, extending, overlapping locks, clearing history or disconnecting access inside Blocker. Stats remain readable. About remains available.

There are roughly ten everyday surfaces; the larger screen count makes their permission, confirmation and failure states reviewable. These are not 56 steps a person has to visit.

### Guarantees and gaps Calum should review

| Requested behavior | V1 design contract |
| --- | --- |
| Named groups containing apps, categories and websites | Supported using Apple's picker and opaque selection tokens. A website is separate from its app. |
| Irrevocable lock | No cancel path **inside Blocker**. Individual authorization remains revocable by the device owner; absolute tamper resistance cannot be promised. |
| Shield with time left | Approximate remaining time when the configuration is requested, plus the fixed end date/time. No ticking timer guarantee. |
| Prevent deleting apps | Request the device-wide app-removal restriction while active. Not a per-selected-app switch, not the implicit parental protection of a child account. Validate effect under individual authorization on a real device. |
| Lock own settings | Gate Blocker's mutations and incoming routes while active. Cannot lock Apple's Settings app or prevent permission revocation. |
| Automatically lift at end | DeviceActivity monitor clears this app's restriction store. Reconcile expired sessions when Blocker next opens. Callbacks are OS-managed; don't claim exact-second execution. |
| Blocked-open attempts | Keep the row, show **— / unavailable**. No documented reliable attempt event stream. Do not invent a numeric count from shield callbacks or usage pickups. |
| Time saved and per-app stats | Explicit estimate and privacy-preserving usage report. If a valid baseline/report cannot be obtained, show unavailable, not zero. |

The last two rows are intentional feasibility adjustments to the brief, exposed in the designs for review rather than hidden in implementation.

## Flows and state inventory

The filenames and [screens.json](screens.json) are the complete inventory. Every item below has HTML and a corresponding PNG in `screenshots/`.

| Flow | Screens and states |
| --- | --- |
| First launch | `01` welcome → `02` Screen Time explanation → `03` illustrative system authorization and device authentication → `06` empty home. No notification or tracking permission. |
| Authorization recovery | `04` declined; `05` Settings instructions; `05b` service error. Try again rechecks actual authorization. Never treat a dismiss or Face ID cancellation as success. |
| Groups | `06` no groups; `07` multiple groups; `08` one saved group; `09` new/invalid form; `10` populated editor; `11` picker with apps and domain; `11b` category selected; `11c` empty picker search; `12` category group; `12b` duplicate name; `12c` save error; `12d` cleared selection; `12e` discard draft; `13` delete confirmation. |
| Start | `14` group + 2h selected; `14b` choose group; `15` 1d; `15b` 3d; `15c` category group; `16` custom; `16a` invalid custom; `16b` custom selected. Review always precedes starting. |
| Commitment | `17` 2h confirmation; `17-confirm-day`, `-three`, `-custom`, `-category` show the other selections; `18` applying protection; `19` start failure with no active restrictions. |
| Active | `20` active home; `21` read-only selection; `22` shield; `22b` shield without readable lock details; `28` locked settings. |
| End / interruption | `23` completed; `23b` permission revoked; `23c` expired restriction reconciliation; `23d` refresh failure; `23e` selections invalidated by revocation. |
| Stats | `24` populated overview; `25` per-app/domain usage; `26` no completed locks; `26b` report unavailable; `26c` loading; `27` definitions. |
| Settings | `29` idle settings; `30` local-data explanation; `30b` destructive confirmation; `30c` deletion failure; `31` about. |

### First use and permissions

Explain the commitment once, then ask for Screen Time access immediately before it is needed. Use `AuthorizationCenter.requestAuthorization(for: .individual)`; this is a personal app, not a child-management flow. iOS owns the alert and Face ID / Touch ID / passcode UI. Screen `03` abbreviates that system sequence; its wording and geometry are illustrative, not strings to implement.

A declined request leads to an actionable recovery state, never a fake ready home. The Settings link should open the supported app Settings destination, with visible instructions for Screen Time; do not depend on private deep-link schemes. On returning, check authorization before showing success. A temporary service error keeps the person's draft and offers retry.

If authorization is later revoked, Apple's selection tokens are invalidated. Retain group names and historical snapshots, mark the lock interrupted when discovered and require selection again (`23e`). Permission recovery must not silently resume an old commitment with stale tokens.

### Building a group

A name and at least one app, category or web-domain token are required. Trim whitespace; use a 32-character name limit and case-insensitive unique names. Disable Save for a blank name or empty selection, with visible reason. Duplicate-name errors stay inline; write failures retain the draft. Leaving a changed draft opens `12e`; canceling the picker restores its entry selection. Deleting a group confirms and preserves historical lock/stat records. Deleting the final group returns to empty home.

The picker is Apple's actual `FamilyActivityPicker`, not a custom search engine. Its category hierarchy, search, icons, checkmarks and available domains are system-owned. Mockups `11*` are selection intent, not a promise to restyle or rearrange those controls. A domain missing from the picker cannot be manufactured by decoding tokens or offering a pretend text field. Empty search suggests normal browsing then retry; it does not guarantee iOS will populate that domain.

App and website selections are independent. Selecting Reddit doesn't automatically select reddit.com; the editor reminder closes that common bypass gap. A category may include more than its visible example apps, and membership is managed by iOS. Show a category summary and native token labels, not a fabricated expanded inventory. Count selected categories separately, deduplicate explicit token sets and do not double-count apps already included in a category.

In native UI, app/category/domain names and icons use Apple's token-based `Label` views. Plain “Instagram” text in these fixtures is visual stand-in content, not evidence that the main process can extract that name. Group names are user-owned strings and can be used in app copy and the shield.

### Starting a lock

With one group, preselect it. With several, select the most recently used valid group and expose the group row. The app never starts from a tab tap or a duration tap. Default length is 2h; offer 1d, 3d and custom. Remember a group, not a previously dangerous long duration. All durations are elapsed time: 1d = 24h and 3d = 72h, including across daylight-saving changes.

Custom supports **15 minutes through 7 days**, matching documented monitoring bounds. Days/hours/minutes are normalized and validated as one total; reject fractional, negative, out-of-range and zero totals. `16a` shows the minimum error; use equivalent inline copy for exceeding seven days. Native inputs use numeric keyboards, visible units and a Done control. No second date-picker flow.

Before commit, a sheet repeats group, selection scope, duration and the absolute end time. For ends beyond today include weekday/date; localize 12/24-hour formatting. Long selections get a scrollable native-label list in that same sheet. Keep the start and back actions visible with Dynamic Type.

“No cancelling” has a scope: the app has no override, and the sheet also explains that iPhone Settings can revoke access. App deletion wording refers to all apps, not just the selected group. Swipe down or Go back dismisses the review without starting anything. The explicit Start action is the only commitment point. Recompute the end time at that tap; preserve the agreed duration, not a stale time calculated minutes earlier. Disable duplicate taps while setup runs.

The future implementation must persist a stable session ID, immutable selection snapshot, start/end instants and setup phase; register the nonrepeating DeviceActivity interval before applying shields and app-removal restriction. Only show Active after setup succeeds. A crash or partial write requires reconciliation; never show the `19` promise “Nothing is locked” until this session's partially applied settings are actually cleared. If rollback isn't confirmed, remain in the visible starting/recovery state and retry reconciliation; do not allow another start. Do not clear another app's or Apple's limits. This is a design contract, not an implemented transaction.

### At the moment of doomscrolling

The shield says what happened, approximately how long remains, and the authoritative end time. No shame, re-entry challenge, countdown seconds, emergency escape link or “one more minute.” The only action is **Close app**, returning a `.close` shield action response. In a web-domain shield use **Close website** and test system dismissal behavior. It never clears restrictions. HTML links lead back to the active mockup solely for design navigation; native dismissal does not open Blocker.

The shield has one icon, title, subtitle and primary action, within Apple's template. The second paragraph in the mockup is part of the same subtitle string, separated by newlines; it is not a second custom view. Fixed end time remains useful if iOS caches the configuration. If lock metadata can't be read, `22b` retains protection and tells the person to check Blocker. Never show an incorrect countdown or unlock due to a missing configuration read. No attempt counter on the shield.

Active home has no primary button. Remaining time and the end time answer the only useful question. The group is inspectable but not editable. Settings explains its locked state; disabled rows don't open mutable screens. Stats can load or fail without affecting enforcement. Any route into settings or group edits, including deep links and stale sheets, must check the session state before mutation. The native tab bar derives destinations from state; static HTML destinations are illustrative and do not implement such a guard.

### End of lock

`DeviceActivityMonitor.intervalDidEnd` clears this session's shield fields and restores the prior app-removal setting in Blocker's named store. Completing never requires reopening the app, a notification or a tap on Done. A closed/rebooted app must reconcile the persisted end time before rendering or applying any old restriction. Never recreate an expired lock from `intervalDidStart` after a delayed callback. The completion screen appears on the next foreground visit once, not as an interrupting celebration.

If an expired shield persists, `23c` offers to clear only expired Blocker restrictions. It is not accessible as an early unlock. Other restrictions can remain because the OS combines settings from multiple sources. An interrupted or uncertain session doesn't increment the streak. No notifications are required in v1.

## Stats that can be defended

Stats use this iPhone only and a fixed last-seven-days period. Avoid adding a chart-range picker. All displayed example numbers are synthetic, not product claims.

- **Blocked-open attempts:** Apple's documented DeviceActivity data includes usage/pickups, not a reliable event for every blocked launch. A shield configuration may be requested or cached independently of attempted launches; treating its invocation as a count is misleading. Shield button taps count only taps, not all attempts. Display `—` and explain unavailable. This is an inference from the documented APIs, not a guarantee that Apple will never add a suitable API. A future verified API can populate the same row.
- **Estimated time saved:** proposed calculation inside the report extension: for each selected app/domain, average usage in matching local-time hour segments over seven complete prior days; compare against actual usage during the completed lock's overlapping segments; sum `max(0, baseline − actual)` once per unique activity. For multiday locks, integrate segments; for DST use actual elapsed segment lengths. Current-period usage shown beside each app includes outside-lock use and is not the subtraction term. The fixture's 24m + 12m + 6m = 42m. This is a counterfactual estimate, not directly measured saved time or the duration of the lock.
- **Baseline and coverage:** require seven valid prior days for that selection plus comparable lock-window usage. Missing data, privacy restrictions, extension failure or a changed selection means `—`, with a reason. Zero is reserved for a successfully calculated zero. Categories require a deduplicated activity union; if category coverage can't be resolved safely in the report, suppress the estimate rather than sum overlapping categories. Keep “Estimated” in every label.
- **Per-app/domain breakdown:** render Apple's token labels, reported usage, and eligible saved-time estimates within a `DeviceActivityReport` extension. Show category grouping if that's all the authorized report can resolve. Do not export private activity results or names to the main app's storage. The full stats report region can live inside the report extension; independently maintained lock history/streak can be rendered by the main app.
- **Unbroken locks:** consecutive locally recorded completed sessions, not consecutive calendar days. Four locks completed without an observed interruption gives 4. A detected revocation or lost enforcement continuity resets the next run. A day without a lock neither increments nor resets it. Explain that unobserved bypasses cannot be disproved. Foreground reconciliation should conservatively mark uncertain continuity interrupted; don't grant success based only on elapsed wall time.

The estimate needs a real-device feasibility check on report history, granularity and privacy boundaries. It is conditional; the unavailable state is the shipping fallback if matching baseline data cannot be processed inside the extension. Do not introduce a second usage entitlement or broader authorization without a separate review. Never repurpose a locked-hour total as time saved.

## Apple API mapping and constraints

| Surface / behavior | Framework / responsibility | Boundary |
| --- | --- | --- |
| Screen Time access | **FamilyControls** `AuthorizationCenter`, `.individual`, authorization status | Owner can revoke access outside Blocker. No parent, Family Sharing or child authorization required for this personal flow. |
| Groups | **FamilyControls** `FamilyActivityPicker`, `FamilyActivitySelection`, token-backed labels | Persist encoded opaque tokens with group metadata. Revocation invalidates tokens. Don't enumerate installed apps or reverse-map bundle IDs. |
| Blocking | **ManagedSettings** named `ManagedSettingsStore`; `shield.applications`, `shield.applicationCategories`, `shield.webDomains`, `shield.webDomainCategories` | Apply a session snapshot. Category policies need deliberate union/deduplication; don't accidentally shield everything. Website shielding is not a universal network firewall or a guarantee for every embedded browser. Validate Safari and intended browsers separately. |
| Deletion restriction | **ManagedSettings** `application.denyAppRemoval` | Device-wide Boolean, not per-app. Restore this store's prior value / nil at the end. Individual authorization does not grant the child flow's implicit protection from deleting the control app or signing out. A user can revoke access; the mockup is not proof of enforcement on iOS 27. |
| End timer | **DeviceActivity** `DeviceActivityCenter.startMonitoring`, nonrepeating `DeviceActivitySchedule`, monitor extension | Persist absolute end instant. OS invokes interval callbacks outside the foreground app. No JS timer, background task or push dependency. Handle invalid dates, unauthorized, excessive activities, too-short/too-long intervals and stale callbacks by session ID. |
| Shield appearance | **ManagedSettingsUI** `ShieldConfigurationDataSource` in the Shield Configuration extension; `ShieldConfiguration` | System controls layout and fonts. Configurable blur/background/icon/title/subtitle/button labels and colors, not arbitrary SwiftUI/HTML, interactive counters or reliable live updates. Returning nil uses system defaults; don't assume nil removes a control. |
| Shield dismissal | **ManagedSettings** `ShieldActionDelegate` in a Shield Action extension; `.close` | The single action dismisses, never unshields. No secondary action in the proposed design. Validate actual system defaults and labels on device. |
| Usage breakdown | **DeviceActivity** `DeviceActivityReport`, `DeviceActivityReportExtension`, filtered activity results | Report sandbox prevents networking and moving sensitive content outside the extension's address space. Keep computations and private labels there. Separate app-owned lock records from protected usage data. |
| Own settings lock | Native app state and mutation guards | No Apple permission to freeze all of iPhone Settings. Do not shield Blocker itself; the user must be able to inspect status and recover expired protection. |

**Request the Family Controls (Distribution) entitlement early**, before planning TestFlight or App Store dates. The Account Holder must request approval for the main app and each applicable Screen Time extension bundle ID (Monitor, Report, Shield Configuration and Shield Action). Development capability is not distribution approval. Match identifiers and provisioning profiles; no entitlement request is performed by this design PR.

App Group access may share app-owned session metadata with enforcement extensions where permitted, but is not permission to move protected activity data out of shield/report sandboxes. Use the minimal supported identifiers/timestamps needed for configuration. Verify lock metadata access in a signed on-device spike before promising the populated shield. The fallback is already designed.

### Primary Apple references

Checked for this design on 2026-11-01. SDK behavior still needs device validation.

1. [Family Controls overview](https://developer.apple.com/documentation/familycontrols) and [WWDC22: individual authorization](https://developer.apple.com/videos/play/wwdc2022/110336/) — owner approval, external revocation and lack of child authorization's implicit deletion protection.
2. [FamilyActivityPicker](https://developer.apple.com/documentation/familycontrols/familyactivitypicker), [FamilyActivitySelection](https://developer.apple.com/documentation/familycontrols/familyactivityselection) and [Displaying Activity Labels](https://developer.apple.com/documentation/familycontrols/displayingactivitylabels) — private selections, token invalidation and display.
3. [ApplicationSettings](https://developer.apple.com/documentation/managedsettings/applicationsettings) — app removal restriction; [ManagedSettings](https://developer.apple.com/documentation/managedsettings) — restriction stores and shields.
4. [DeviceActivity](https://developer.apple.com/documentation/deviceactivity), [minimum interval](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/monitoringerror/intervaltooshort), [maximum interval](https://developer.apple.com/documentation/deviceactivity/deviceactivitycenter/monitoringerror/intervaltoolong) and [WWDC21: monitor lifecycle](https://developer.apple.com/videos/play/wwdc2021/10123/) — schedule limits and extension callbacks.
5. [ShieldConfiguration](https://developer.apple.com/documentation/managedsettingsui/shieldconfiguration), [ShieldConfigurationDataSource](https://developer.apple.com/documentation/managedsettingsui/shieldconfigurationdatasource) and [ShieldActionResponse](https://developer.apple.com/documentation/managedsettings/shieldactionresponse) — template customization, sandbox and action behavior.
6. [DeviceActivityReport](https://developer.apple.com/documentation/deviceactivity/deviceactivityreport) — privacy boundary and report extension.
7. [Requesting the Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement) — distribution request for app and extensions.
8. [Apple: iOS 27 design refinements](https://www.apple.com/os/ios/) — Liquid Glass contrast and user-controlled material appearance. Browser CSS approximates it; native implementation should inherit system materials and accessibility settings.

## Components and tokens

The aesthetic borrows Vercel's disciplined black/white hierarchy, not its desktop dashboard anatomy. The person is about to act on impulse: one conspicuous action, legible consequence, no visual competition. Native SF typography in implementation; system sans fallback in browser captures. No external assets, branded app icons or downloaded typefaces.

| Token | Value / use |
| --- | --- |
| Background | `#000000`, opaque app canvas |
| Surface | `#141414`, fields and secondary actions |
| Raised | `#242424`, selected navigation / system prompt approximation |
| Separator | `#333333`, structural row boundaries |
| Primary text | `#FAFAFA`, headings and actions |
| Secondary text | `#AAAAAA`, supporting copy; never the only error signal |
| Quiet | `#777777`, decorative handle / non-text details |
| Glass | `rgba(35,35,35,.86)` with 24–28px backdrop blur and a subtle white edge, navigation and sheets only |
| Type | Title 34/37, sheet title 30, section 22, body 16/24, prominent body 18/26, caption 13/19, timer 66/73 tabular |
| Space | 4, 8, 12, 16, 20, 24, 32, 40; 24pt side inset |
| Corners | Fields 12; choice controls 14; primary actions 18; sheets/nav 32. Native controls use system geometry. |
| Touch | Minimum 44pt target; primary actions 54pt; rows 64pt or taller |
| Safe areas | 62pt top allowance and 34pt bottom region in reference frame; native uses actual safe-area insets |

Reusable components: compact back/header, token-label selection row, field with visible label and inline error, four duration choices, high-contrast primary action, quiet secondary action, glass commitment sheet, three-destination glass tab bar, lock status/end-time summary, stats list and explanatory note. Groups and stats are flat rows, not repeated nested cards.

Liquid Glass belongs to the control layer, while content stays opaque black. The monochrome sheet is deliberately tinted for readable irreversible-action copy. The OS controls system picker/permission/shield treatment; do not try to inject the app's glass stylesheet into them. Native system materials should respect the iOS 27 glass preference, Reduce Transparency and Increase Contrast. The HTML includes solid/reduced-transparency and contrast fallbacks, though support for those media queries varies by browser.

### Accessibility and motion

Use system Dynamic Type in native UI, semantic headings, explicit field labels, token labels and VoiceOver names. Timer speaks “1 hour, 42 minutes remaining,” not compressed digits. Announce a meaningful minute change on request, never every second. Locked rows say “Unavailable until 11:41 am”; selection is indicated by shape/check/text, not color. Announce form errors and focus the invalid field. Distinguish “unavailable” from numeric zero for assistive technology.

Large text uses scrolling content, stacked label/value rows and a pinned safe-area action container; long group names wrap to two or more lines without obscuring the action. A long confirmation selection list scrolls independently of the two actions. These HTML snapshots use the reference text size and are not a completed Dynamic Type layout test. The native shield's typography/layout remains Apple's responsibility.

No custom entrance, progress or celebration animation in these design files. Native navigation and sheets can retain system motion and Reduce Motion behavior. Never require holding, swiping precisely, remembering a code or reading a ticking deadline to confirm a lock.

## Room for later, without extra UI now

Emergency unlock could add a distinct “Request unlock” state and a persisted ten-minute wait; it is absent in v1 and must not share the completion/recovery route. Schedules can create the same session model from a future trigger, without adding an idle home card now. A pause-before-open would require its own platform feasibility review; it is not implied by a custom shield. A widget could read the same non-sensitive active end timestamp and show a system timeline. No placeholder tabs, switches, “coming soon” rows, account or sync scaffolding.

## Reproduce and validate

```sh
python3 apps/blocker/design/build.py
# Use an existing external Playwright install; no app or repo dependencies needed.
PLAYWRIGHT_MODULE=/path/to/playwright node apps/blocker/design/render.mjs
# Optional: CHROME_BIN=/path/to/chrome
```

Open `index.html` directly from disk. Native fields are editable to inspect focus appearance; links are deterministic transitions between fixtures, not working form submissions or real permission/settings actions. Error variants are accessible from the contact sheet. Different duration confirmations deliberately converge on one representative starting/active fixture. No backend, app session or enforcement logic exists here.

The renderer captures each screen, records browser/runtime/resource errors, checks reference-size content overflow and out-of-frame elements, then captures the full contact sheet. [render-report.json](render-report.json) records the result. Review representative PNGs visually in addition to reading that report; geometry checks do not establish usability or native fidelity. Additional delivery checks and platform/tool limitations are in [VERIFICATION.md](VERIFICATION.md).

Before app implementation can claim enforcement: validate individual authorization/revocation, actual picker availability, selected apps/categories/domains, global deletion restriction and restoration, signed extension metadata access, shield caching/dismissal, expiry with app terminated/rebooted, DST/time-zone/clock changes, overlapping Apple limits, report privacy/baseline availability, VoiceOver and Dynamic Type on a real iPhone. This PR implements none of these APIs.
