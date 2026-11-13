# Integrated native export UI review

November 7, 2026. The real local-development app successfully generated JSON and CSV exports, presented Apple's native share controller, removed temporary files after cancellation, and committed a reset. Visual QA also found and corrected simulator startup configuration and clipped destructive copy.

## Environment and evidence

- Simulator: Panel Personal Duo Review, `16B07AED-DFFE-4DE1-93E2-B9CEB51A2386`, iOS 27.2, outer display 1398×2034.
- Integrated `app.getfolding.Folding`, using its real Keychain identity and sandbox journal. No injected journal, fixture app, production account or fabricated fold records.
- Device Hub/CUA for interaction; simulator screenshots and read-only filesystem/SQLite checks. Locale launch arguments selected English and German. Default text size was 3; maximum accessibility size was 11. Simulator appearance/text size were restored to Light/3 afterward.
- Local ignored screenshots: `build/ui-review/export/`. These are engineering evidence, not release screenshots.

| Check | Observed outcome | Screenshot |
| --- | --- | --- |
| Real launch / Today, light | Healthy zero-fold personal summary after simulator entitlement fix | `today-light.png` |
| Settings, light | Native grouped form, concise sections and export entry | `settings-light.png` |
| Settings, dark / maximum text | Labels reflow; native form remains navigable by page scrolling | `settings-dark-accessibility.png` |
| JSON sharing, light | Native header “Folding”, “JSON · 518 bytes”, Copy and Save to Files controls | `json-share-light.png` |
| CSV sharing, dark | Native header “Folding”, “ZIP Archive · 1 KB” | `csv-share-dark.png` |
| CSV sharing, dark / maximum text | Native controls remain reachable; file-size subtitle ellipsizes and the horizontal activity row extends beyond viewport | `csv-share-dark-accessibility.png` |
| Reset, dark / maximum text, before correction | Final effect clipped beneath buttons; dragging the message did not expose it | `reset-dark-accessibility.png`, `reset-dark-accessibility-scrolled.png` |
| Reset, English, corrected / maximum text | All effects and both actions visible without shrinking text | `reset-en-dark-accessibility-fixed.png` |
| Reset, German, corrected / maximum text | All effects/actions visible; system hyphenates the title | `reset-de-dark-accessibility-fixed.png` |

The primary agent independently inspected the JSON share screenshot and confirmed its native filename/type/layout. The native share subtree did not expose its child controls through Device Hub's AX bridge; cancellation was performed using the visibly rendered close control. This is not a VoiceOver acceptance result.

## Real file and reset checks

- JSON file was actually `Folding.json`, 518 bytes, parseable schema version 1 with zero events in this development journal.
- CSV file was actually `Folding.zip`, 1,464 bytes, containing `events.csv`, `sessions.csv`, `daily-summaries.csv`, and `README.txt`.
- Closing each native share surface returned to Today. Read-only checks confirmed the corresponding temporary file no longer existed after cancellation.
- Reset was executed on the empty development journal. Read-only SQLite checks showed zero events before/after and reset markers increasing from 0 to 1. No prepared export files remained. This verifies the UI invokes a durable reset; it does not prove removal of populated production history/public scores.
- No file was sent to another person/service. Successful external destination delivery remains untested. Reset racing an active/queued export is covered by the separately reported service/presentation tests, not by this manual empty-journal flow.

## Findings corrected during review

**Real startup failed with OSStatus -34018.** The initial build opened Today with “Tracking unavailable” plus a generic error before export. Simulator `securityd` reported “Client has neither application-identifier nor keychain-access-groups entitlements.” Earlier tests injected a journal and missed the default runtime bootstrap. Primary added simulator-only identity/Keychain entitlements and a real runtime/reopen regression; reinstalling the corrected build without deleting app data fixed startup. Simulator entitlement evidence lives in the embedded `__TEXT,__entitlements` / generated Simulated.xcent and link command; an empty `codesign` entitlement listing alone is not authoritative for simulator binaries. Original evidence: `integrated-launch-error.png`.

**Reset effects clipped at maximum text.** Shortened all ten localized messages while preserving history, scores and medals. English now reads “Deletes history, scores and medals.” German also uses concise title/action “Zurücksetzen?” / “Zurücksetzen”; its Settings row remains “Verlauf zurücksetzen”. Both English and German were rebuilt and re-rendered at maximum text, with the full effect description and actions visible. No Dynamic Type cap or custom alert was introduced.

**Duplicate empty-state copy.** Primary removed the duplicate “Tracking unavailable” description beneath the identical title. This source correction is separate from the healthy launch acceptance above.

Localization validation (125 keys × ten locales), ten mutation regressions, and native Xcode compilation passed after these copy changes.

## Remaining gates

- Native tabs remain an icon-only right rail on the Duo outer display; visible-label acceptance is still open.
- Inner-display review remains open. No screenshot here certifies unfolded layout.
- The system share header truncates its size subtitle at maximum text. The filename/type and cancellation remain apparent, but full VoiceOver/navigation review is still needed; no replacement of Apple's native share UI is proposed.
- The attempted `today-dark-accessibility.png` was interrupted by a concurrent test launch and is blank. It is **not** acceptance evidence. Dark/max-text Settings, share and reset captures above were completed with the simulator reserved for QA.
- Populated-history reset, cross-account invalidation, all localized flows, external share destinations, full VoiceOver, release screenshot matrix, production account/iCloud and physical-device behavior remain outside this scoped check. Physical checks remain owner-approved F13 deferrals, not passed.
