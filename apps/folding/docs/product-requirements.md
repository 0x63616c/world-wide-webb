# Product requirements

> Historical planning notes. The consolidated [v1 review specification](review-spec.md) supersedes proposals and unresolved choices below. Retained for rationale and traceability.

Status: planning baseline, November 7, 2026.

## Purpose and positioning

**Agreed:** a personal folding tracker for iPhone Duo, with optional competition. It should satisfy curiosity, interest in device usage, and playful competition. It must feel exceptionally polished and native to iOS 27, with standard system components and appropriate Liquid Glass treatment.

**Proposed positioning:** a personal folding journal with effortless setup, useful insights, and optional comparison. Competitor differentiation still needs validation. HingeWorthy is the principal known reference; counters and widgets alone are not a proven differentiator.

The final product name is **Folding**, selected by the owner. App Store registration is pending. The earlier working title Foldr was dropped because other software uses it. The owner subsequently purchased getfolding.app; see the current delivery plan.

## Agreed feature scope

- Automatic fold logging through user-configured Shortcuts automations.
- Record opens, closes, and useful derived statistics; investigate fully open events and completed cycles.
- Time unfolded, including time left unfolded overnight.
- Total hinge travel and a playful distance representation are desired, subject to measurement feasibility and honest estimate labels.
- Personal history synchronized through iCloud.
- Statistics and history, including daily activity and longer-term trends.
- System, light, and dark appearance settings.
- Accent-color customization.
- Selectable home-screen statistics; all discussed metrics should be available where supportable.
- Installable widgets with configurable metrics and coordinated appearance.
- Optional daily fold threshold, configured in Settings, with a notification when reached.
- One-tap CSV package export.
- Reset personal history and public scores together.
- Optional competition using Sign in with Apple and a separate public identity; exact nickname rules remain open.
- Weekly, monthly, and all-time leaderboard views, podium treatment, and historical personal placements.
- Independently selectable notification categories.
- Free app with an optional “Buy me a coffee” tip jar; no paid core feature tier.
- A well-timed system review request.
- Independent agent review of the rendered UI against the agreed design brief.
- Repository-managed App Store listing, generated screenshots, GitHub CI, and automated releases.
- A small protected administration interface and infrastructure as code for Cloudflare resources.

## Guided setup

**Agreed:** explain setup, open Shortcuts for the user, guide each step, and test actual physical opens/closes along the way. Use attractive, purposeful animations. Allow setup to be rerun from Settings.

**Proposed flow:**

1. Show **Log Duo Opened** and open Shortcuts for its Display automation.
2. On return, start checking automatically and ask the user to open the Duo.
3. Repeat with **Log Duo Closed** and a physical closing.
4. Show successful setup and initial activity.

Preserve progress across app switches and offer targeted recovery from failed checks. Do not make users tap Test or watch a countdown. Exact Shortcuts handoff behavior still needs physical-device acceptance.

Display evidence such as “Open test passed,” “Close test passed,” and “Last event received.” Do not claim to know an automation is currently enabled unless an actual supported inspection API is verified. Silence alone does not prove tracking is broken.

The haptic-engine tracking idea was explicitly dropped. Optional tactile feedback is a separate design choice.

## Statistics and appearance

Desired available metrics: today's folds, opens, closes, completed cycles, fully open events if observable, time unfolded, weekly trends, lifetime totals, hinge travel/distance if supportable, and competition percentile.

**Proposed default summary:** today's folds, time unfolded, and weekly trend, with an Edit Summary screen for selection and ordering. Widget selection should be independent of the app summary. Exact widget sizes and metric combinations remain open.

Use the same design language across both displays. Respect system widget rendering modes, accessibility, Dynamic Type, Reduce Motion, and contrast preferences. Theming must not depend on color alone.

## Monetization and reviews

**Agreed:** all app functionality is free, with optional tips. Request a review at an appropriate moment after the user has experienced the product.

**Proposed:** consumable StoreKit tip products, with no ranking benefit or exclusive functionality. Ask for a system review after several successful tracking days or the first weekly summary rather than immediately after setup. Do not gate the request behind a positive-sentiment question. Tip amounts and request timing remain undecided.

## Day-one localization — agreed

- English.
- German.
- French.
- Spanish for Spain and Latin America; precise supported locale identifiers to be finalized.
- Japanese.
- Korean.
- Brazilian Portuguese.
- Simplified Chinese.
- Traditional Chinese.

AI-assisted translations are accepted. Support the complete user journey: app, setup, App Intent action names, widgets, notifications, accessibility text, tips, and App Store assets. Verify Apple's localized Shortcuts labels rather than inventing translations of system controls.

Use repository-owned String Catalogs, context and terminology guidance, plural handling, locale-aware formatting, and localized release screenshots. Each language must pass setup and layout checks before shipping. Native-speaker TestFlight review is desirable; it is not yet staffed.

Italian, Dutch, Arabic, Turkish, and Vietnamese were suggested as future candidates, not committed launch languages.
