# Native Apple design standard

Decision date: 5 November 2026. Scope: the native app and shared SwiftUI views.
The web Board retains its fixed panel geometry and its existing web primitives.

Calum's direction is native iOS 27, iPadOS 27 and macOS 27, with iPhone Duo
support. Use Apple's actual components and platform behavior, not a painted
approximation. HomeView is the reference for the wall panel's glanceable faces
and direct accessory controls; it does not replace iPhone or Mac conventions.

## Source hierarchy

1. [Apple's iOS developer hub](https://developer.apple.com/ios/), current HIG and
   API documentation, checked against declarations in the installed SDK.
2. [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass),
   [Settings](https://developer.apple.com/design/human-interface-guidelines/settings),
   [Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo),
   [macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos).
3. [Apple HomeView](https://www.apple.com/apple-homeview/) imagery and published
   interaction demonstrations as visual reference. Do not infer public SwiftUI
   APIs or undocumented exact measurements from marketing imagery.
4. Pinned community skills in `.agents/skills/SOURCES.md`. Resolve conflicting
   advice in favor of current Apple documentation and explicit product choices.

## Standard components

- Navigation belongs to `NavigationStack`, `NavigationSplitView`, native
  toolbars and, where the information hierarchy warrants it, `TabView`.
  Supply toolbar actions with a title and SF Symbol, preserving system overflow.
- Settings uses `List`, `Form`, `Section`, `NavigationLink`, `LabeledContent`,
  `Toggle`, `Picker` and `Slider`. Mac uses a `Settings` scene with Command–Comma.
  Let the system choose row heights, section surfaces, selection and glass.
- Use `ColorPicker` for detailed light colour selection. Keep presets and
  direct adjustment close to the fixture they affect. A colour editor has an
  explicit save/cancel boundary; dragging previews locally before committing.
- Use real `.glass` / `.glassProminent` control styles and system glass chrome.
  Custom `.glassEffect` is for a justified app-owned floating control, not every
  content card. Never hand-roll blur or cover native forms with fake glass.
- Prefer semantic fonts and foreground styles, Dynamic Type, SF Symbols, and
  native light/dark appearance. Wall-panel immersive faces may intentionally
  use a fixed dark canvas. Personal-device settings follow system appearance.
- Shared role-named constants cover app-owned spacing, accent, hero typography
  and control sizing. Do not wrap or restyle every system control. Reuse existing
  primitives; place platform-independent primitives in `packages/platform` and
  native reusable substrate in PanelKit or the shared SwiftUI component layer.
- Keep loading, empty, error and stale states consistent and honest. Use native
  unavailable states and retry actions; keep confirmed content during refresh.
  Control mutations show intent immediately and roll back on failure. Never
  fabricate live data or show a spinner in place of a tapped control.

## Layout and continuity

Use available space and size classes, not device names or a scaled panel.
Interactive content respects all safe-area edges; decorative backgrounds may
extend behind them. Preserve navigation, selected room, draft colour/link,
scroll position and playback across resizing, opening and folding.

Regular widths can show list and detail together; compact widths navigate the
same hierarchy one page at a time. System containers handle bars, sheets and
fold avoidance. Confirm any additional reserved-region APIs in the SDK and
retain a working older-runtime path. Do not invent pose-specific features.

## Implemented structure

Calum chose shared destinations and data with native personal navigation on
5 November. `PanelAppContent` is the single destination resolver. `PersonalHome`
owns native tabs on iPhone/Duo and a sidebar on the Mac design host; `HomeView`
retains the wall clock/launcher. Personal settings omit wall-only background,
dimming and clock-return controls. The shared app-preferences owner also serves
the Mac Settings scene, so changes apply immediately to open destinations.

Climate uses the SDK's active division reserved regions for its essential
readout and adjustment buttons. Navigation and toolbar placement remain owned
by the system. Spotify drafts and shared providers stay above layout changes.

## Delivery sequence

1. Establish this standard, pin reviewed skills, and settle personal-device
   navigation separately from the wall panel's clock/launcher experience.
2. Replace the custom-looking Settings sidebar and typography with native
   selection, forms, toolbars and platform-specific Settings presentation.
3. Apply shared controls and adaptable layout to Lights, Climate and Spotify;
   audit the shell and remaining destinations for conflicting chrome/styles.
4. Enable and verify the personal-device path without changing the web Board.
   The Mac target is currently a design host, not a separately shipped live app.
5. Finish behavioral fixes: wallpapers, idle durations, active-walk/timer wake,
   timer cues, optimistic controls, quiet walk start and persisted Tesla readings.
6. Verify, capture evidence, push a Conventional Commit PR, wait for all required
   checks, merge as authorized, and verify server/native release processing.

## Acceptance evidence

Compile both native targets. Exercise panel at 1366×1024 points, compact iPhone,
Duo outer/inner displays and fold transitions, and a resizable Mac window.
Check navigation, input with keyboard, larger text, VoiceOver labels/order,
Reduce Motion/Transparency, and RTL where changed layout requires it. Capture
real running UI and clips under `docs/screenshots/`; label test fixtures and
state any device-only behavior not tested. A build alone is not visual QA.
