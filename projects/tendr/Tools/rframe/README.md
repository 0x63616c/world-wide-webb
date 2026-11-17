# rframe

Tool-only Swift package that frames Tendr's raw simulator captures for the App Store. The app
does not depend on it; `fastlane ios screenshots app:tendr` runs it after fastlane snapshot.

```sh
swift run --package-path projects/tendr/Tools/rframe -c release rframe \
  projects/tendr/screenshots.json build/screenshots/tendr/raw \
  projects/tendr/fastlane/screenshots/en-US build/screenshots/tendr/overview.png
```

`rframe` needs macOS/AppKit and writes opaque PNGs. Each `shots` entry supplies `screen`
(the `snapshot()` name), optional `appearance` (`light` by default or `dark`), `eyebrow`, and
`headline`, and becomes a framed 1320×2868 image. Each `duo_shots` entry (`screen`, `appearance`)
is copied unframed at the Duo outer display's 1398×2034 as `duo-NN-<screen>.png`. Raw captures are
snapshot's output: `<raw-dir>/<appearance>/en-US/Screenshots <device>-<screen>.png`. Every capture is
size-checked before the staged PNGs are replaced.
`swift test --package-path projects/tendr/Tools/rframe` checks the configuration rules; it does
not render frames.
