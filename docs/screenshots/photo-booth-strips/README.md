# Four-photo strips and self-timers

Real native UI recording on a 1366×1024-point iPad Pro (12.9-inch, 6th generation)
simulator, local Xcode 27. PNGs are frames from the actual recording at panel
resolution. The 24.5-second MP4 runs at normal speed.

The explicit DEBUG-only `-hybridBoothCamera` input supplies numbered, labelled
simulator test JPEGs. The real capture sequence, countdowns, compositor, save
request/receipt, photo provider and gallery run normally. These are not private
photos or evidence of physical four-shot camera capture.

- `demo.mp4`: select Strip, choose a five-second timer, cancel, turn the initial
  timer off, take four shots with three-second posing countdowns, and open the
  saved strip from the gallery.
- `preview.png`: the saved, vertically composed four-photo strip.
- `gallery.png`: reopen that strip through the real gallery UI/provider.

Validation: seven model tests (ordered image content, timer, cancellation,
partial failure, exact-byte save retry and ownership); two native UI tests
(strip/timer/cancel/gallery plus existing fresh PIN/background/reopening);
current native build and monorepo typecheck passed. Physical single-photo capture
was confirmed by Calum on build 149; physical strip capture/rotation remains to
be observed on the panel. Release evidence is recorded in the PR.
