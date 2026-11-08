# Tendr 1.0.0 (8)

September 10, 2026. Uploaded successfully but not distributed. Superseded by build 9 with the requested Home layout cleanup.

The live medication estimate now requests a 60 Hz animation timeline (1/60-second minimum interval), replacing build 6's one-second polling. Every refresh uses real wall-clock time and the same absorption/clearance formula. It does not queue digits or accelerate medication kinetics. Display scheduling can still drop frames, and sufficiently rapid changes can skip rounded digits. The timeline pauses while inspecting a fixed chart time. Chart sampling and stored data are unchanged.

Build 7's 30 Hz candidate was uploaded but never distributed; this build supersedes it.

Verification: precision persistence UI test passed on iOS 26.2 Pro Max; the prior 30 Hz candidate also passed the main-screen/logging flow. Release archive succeeded. The seven-decimal layout was visually reviewed on Pro Max. No model parameters changed.
