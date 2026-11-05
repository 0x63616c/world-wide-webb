# iPhone Duo redesign notes
Journey: launcher → Settings, Lights, Climate and Spotify
Stack: SwiftUI with UIKit host; iOS/macOS 26 minimum; local Xcode 27.2
Stage: 5  Next: publish PR and simulator evidence; wait for Calum's design review before merging

## Findings
- Shell: Change — custom Back/safe-area handling prevents standard vertical bars [T462].
- Settings: Change — oversized custom sidebar rows; use native selection, forms and toolbar [HIG].
- Lights/Spotify: Change — fixed side-by-side content needs compact and regular layout [T461].
- Climate: Change — keep the full-page direct control but fit narrow/short space [HIG].
- Continuity: Change — keep draft, selection and providers owned above resizing boundaries [T466].
- Startup: Decision — personal devices need native navigation or the panel's clock/launcher.
- Outer layout: recommend inset interactive content over extending backgrounds [T466].
- Bars: system placements, title+symbol, default overflow; no custom vertical opt-out [T462].
- Fold: prefer system containers; add reserved-region handling only for demonstrated collisions [T463].
- Ready: native SwiftUI, real glass APIs, shared feature catalog, observable provider ownership.
- N/A: custom table-pose features, hinge effects and extra windows are outside this journey.
- Camera changes are outside this pass; do not claim physical Duo camera validation.

## Decisions
- Personal startup: native navigation chosen by Calum (5 November 2026); shared screens and logic.
- Wall panel: retain HomeView-style clock/launcher and glanceable faces (user).
- Appearance: native system components and platform styles; HomeView guides panel content (user).
- Inner display: expand existing hierarchy, keeping the same controls and state (agent recommendation).
- SDK: keep deployment target, compile-check new APIs and guard availability (agent).

## Done / verified
- Assessed actual Settings in panel simulator and current shell/build configuration.
- Existing behavior slice: native unit tests and repo typecheck passed before Spotify additions.
- Skills: reviewed and pinned SwiftUI Pro, design-system, four focused Duo skills.
- Built both native targets; native tabs/sidebar and shared destinations are implemented.
- Duo simulator: outer/inner, opening with a Spotify draft, rotation and partial folding verified.
- Climate readout avoids active vertical/tabletop division regions using the public SDK API.
- Spotify transport and climate mode/fan use system toolbars; no custom vertical bar.
- Mac Settings opens with Command–Comma. Phone settings omit wall-only idle controls.
- Evidence and remaining device-only limits: `../../docs/screenshots/panel-experience/README.md`.
