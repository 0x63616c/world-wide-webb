# Tendr-style storefront frames — November 8, 2026

Scope: local screenshot template/pipeline implementation under #42; independent
frame/code review and focused checks. App Store submission and CI remain deferred.

Adapted the tracked label, bold headline, graphite backgrounds and device framing
from `0x63616c/apps`'s `packages/RDesign/Sources/rframe/RFrame.swift`. Folding keeps
the entire native capture visible inside a thin frame and does not invent Duo
hardware features. Localized headlines/labels, frame geometry and scene themes are
repository sources. Output is opaque sRGB PNG. Fixed the previous 24-bit AppKit
bitmap-context failure by drawing into a supported context then exporting RGB.

Each locale produces eight Duo screenshots in scene order (outer then inner), plus
four medium canvases composed from outer captures. Alternating dark/light capture
uses separate appearance groups and retains the light-only uncaptioned tip review
asset. Release manifests bind copy/plan/frame/renderer hashes; validation checks
Fastlane's actual upload-slot inference and Apple's ten-image gallery limit.

Added `storefront`, a final-preflight-gated listing upload without App Review
submission. `submit` shares it. Apple readback checks localized version copy and
app-info titles/subtitles/privacy URLs, categories, release notes when applicable,
and ordered screenshot checksums, file sizes, dimensions and processing completion.
Pending readback can resume without repeating an acknowledged upload.

Verified locally:

- Screenshot scheme `build-for-testing` succeeded with generic simulator destination;
  no simulator was booted or used by this task (`build/storefront-build.log`).
- 120 renders across ten locales, four scenes and three canvas sizes; 361 assertions
  passed, including RGB/no-alpha PNG and pinned Deliver slot classification.
- Readback regression checks passed two tests/ten assertions rejecting wrong image
  order, pending processing, changed bytes, dimensions, gallery count, title/category
  mismatches and missing update notes; first-version notes are explicitly inapplicable.
- Existing release regression suite passed six tests/15 assertions; all Fastlane
  lanes loaded. Swift formatting and Ruby syntax checks passed.
- Independent review identified a stale-source guard gap and frame-corner mismatch;
  both were corrected. Draft images use saved captures and are **not** new
  storefront capture evidence. Preview: `build/storefront-template-preview/today-final.png`.

Remaining acceptance under #42: capture the complete current UI from a clean,
committed source, review all localized screens and copy, seal release assets, then
exercise the guarded upload/readback against Apple. The shared checkout contains
ongoing app changes and other chats have active simulators; this task did not
interrupt them or label old/synthetic captures as current release screenshots.
No listing upload, App Review submission, public Duo badge, CI pass, or device pass
is claimed by this checkpoint. See `fastlane/RELEASE.md` for repeatable commands.


## Superseding current-main capture

The four-scene local checkpoint above is historical. The current five-scene,
150-image native capture and actual Apple draft upload are tracked in
[App Store preparation](app-store-preparation-2026-11-08.md). Do not use the earlier
preview or synthetic render output as current release capture evidence.
