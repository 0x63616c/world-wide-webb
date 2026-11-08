# Tendr 1.0.0 (7)

September 10, 2026. Uploaded successfully, but not distributed to Owner Preview. Superseded by build 8 after the requested change to 60 Hz.

The live medication number now uses an animation timeline with a 1/30-second minimum interval instead of one-second polling. Each update evaluates the existing model at real wall-clock time; no artificial acceleration or queued digit counting. At ordinary seven-decimal rates this exposes intermediate digits previously skipped between one-second samples. Device scheduling and faster model changes may still skip digits; the display always catches up to the correct time instead of drifting. Chart inspection pauses the animation timeline.

This is a display-only change. Dose data, model parameters, decimal preferences and chart sampling are unchanged. The precision persistence and main-screen/logging UI tests passed on iOS 26.2 Pro Max (2 tests, 0 failures); release archive and upload succeeded.
