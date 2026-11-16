# rframe

Tool-only Swift package that frames Tendr's raw simulator captures for the App Store. The app
does not depend on it; `scripts/frame-screenshots.sh tendr` runs it.

```sh
swift run --package-path projects/tendr/Tools/rframe -c release rframe \
  projects/tendr/screenshots.json build/screenshots/tendr/raw \
  projects/tendr/fastlane/screenshots/en-US build/screenshots/tendr/overview.png
```

`rframe` needs macOS/AppKit and writes opaque 1320×2868 PNGs. Each `shots` entry supplies `screen`
(capture basename), optional `appearance` (`light` by default or `dark`), `eyebrow`, and
`headline`. Raw captures live under `<raw-dir>/<appearance>/<screen>.png`.
`swift test --package-path projects/tendr/Tools/rframe` checks the configuration rules; it does
not render frames.
