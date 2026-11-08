# Tracking-phone UI review

November 7, 2026. Native Debug app, iOS 27.2 Duo simulator
`16B07AED-DFFE-4DE1-93E2-B9CEB51A2386`, outer display. These are integrated
app captures, not static previews. No production account or cloud data was used.

## Implemented

- Settings shows the authoritative selected phone as This iPhone, Another iPhone,
  or Not selected. It does not invent remote device names.
- Today offers phone selection when the analytics snapshot requires it.
- Use this iPhone opens a native, scrollable confirmation before invoking the
  injected private-selection command. It explains that folds not yet received
  from other phones will appear only in exports. It makes no public handover claim.
- Selection changes only when the authoritative snapshot changes; command failure
  preserves the previous selection and uses the existing error presentation.
- Ten new semantic strings are translated across all ten launch locales.
  AI translations are not native-speaker certified.

## Verified

- Focused native `PresentationTests`: 14 passed, including explicit/no-selection
  status, no optimistic selection before a committed snapshot, and failed selection
  preserving the existing phone. The no-selection test retains both source totals.
- Localization validation: 135 semantic keys × 10 locales. Ten validator mutation
  tests passed. Xcode compiled the catalog in the native test build.
- Real Settings navigation showed Not selected and Use this iPhone in light mode.
  Evidence: `build/ui-review/phone/not-selected-light.png`.
- The confirmation at maximum accessibility text size showed the complete effect
  text, Use this iPhone, and Cancel without truncation or a font-size cap.
  Evidence: `build/ui-review/phone/confirmation-maxtext.png` (light mode).
- Test result: `build/ui-phone-selection/Logs/Test/Test-Folding-2026.11.07_10-27-15--0800.xcresult`.

## Pending

External changes repeatedly moved Device Hub to another task's iPad surface.
The review stopped rather than competing for its controls. Actual selection through
UI, dark rendering, long-locale rendering, and a rendered multi-source Today prompt
remain unverified. The native presentation tests cover the underlying selection
states; they do not substitute for those renders or runtime transfer acceptance.
The Duo was restored to the normal large content-size category using its explicit
simulator ID after review; no unrelated device's settings were changed.

Public competition handover, iCloud/device integration, VoiceOver, and physical
Duo behavior are outside this UI batch. Existing native tab-label and inner-display
acceptance gaps remain open as documented in prior UI reviews.
