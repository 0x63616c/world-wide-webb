# Tapes

A private home video app for movies, shows and DJ sets kept on the NAS. The Mac mini serves
the library and remembers progress; the iPhone, Mac and Apple TV apps browse and play it.
Distributed through TestFlight only.

## Parts

- `server/`: a Rust binary, `tapes`.
  - `tapes serve` is the HTTP API on port 4300: library, artwork, streaming and progress.
  - `tapes import movie|episode|set` converts files into the library format. Video becomes
    HEVC `hvc1` and audio AAC, because the Apple TV 4K (2nd gen) has no AV1 decoding.
    Subtitles become `tx3g`. It records the resolution and HDR, Dolby Vision and Atmos as
    badges, which the movie page shows.
  - `tapes list`, `tapes edit`, `tapes remove`, `tapes init` and `tapes openapi` manage the
    library and API description. Add `--json` to any command.
  - Whole downloaded shows and movies, with TMDB artwork, go in through the `tapes-import`
    skill (`.claude/skills/tapes-import/`).
  - The library layout and `info.json` format are documented at the top of
    `server/src/library.rs`.
  - A library root needs `tapes-library.json`. Without it the server reports the library as
    unavailable and keeps the last good scan; it never shows the library as empty.
- `openapi.json`: generated with `cargo run -- openapi > ../openapi.json` from `server/`. CI
  fails if it is out of date.
- The app: `project.yml` (XcodeGen), with `Sources/` and `Resources/` shared by the `Tapes`
  (iOS), `Tapes-macOS` and `Tapes-tvOS` targets.
  - `TapesAPI/` is the generated client from swift-openapi-generator. Regenerate it after
    changing `openapi.json`:
    `swift-openapi-generator generate --config TapesAPI/openapi-generator-config.yaml --output-directory TapesAPI/Sources/TapesAPI openapi.json`.
  - `TopShelf/` is the Apple TV Top Shelf extension (`Tapes-TopShelf`): Continue Watching, or
    the day's pick when nothing is in progress. It shares `Sources/Library.swift` and
    `Sources/Server.swift` with the app. Items open `tapes://open/<id>` (the item's page) or
    `tapes://play/<id>` (plays it); the app handles both on every platform.
  - Debug builds use the `AppIconDev` icon, with a red DEV banner; TestFlight builds use
    Release and the normal icon.
  - The app refreshes the library every minute while it is open. Settings, the last tab,
    shows what the library holds and can reset watch history on every device.
  - The app connects to `http://homelab-mac-mini.local:4300`. Use the `-server URL` launch
    argument to point it somewhere else.

## Run

```sh
cd server && cargo test
cargo run -- serve --library /path/to/library --database /tmp/tapes.sqlite --listen 127.0.0.1:4300
xcodegen generate   # in projects/tapes; then open Tapes.xcodeproj
```

## Release

- **App:** merging app changes to `main` uploads a TestFlight build to the "Owner Preview"
  group, using the shared fastlane `beta` lane (`app.yml`, `tapes-delivery.yml`). Signing
  comes from the `tapes` Match branch, which uses the Tendr Match password (1Password "WWW
  Tendr and Callkeep Match recovery"). The tvOS build signs the app and the Top Shelf
  extension (`co.worldwidewebb.tapes.TopShelf`) with separate profiles; `app.yml` lists the
  extension under `extensions`.
- **Server:** CI tests the server and builds `ghcr.io/0x63616c/www-tapes`. On `main` it pushes
  the image, and `tapes-promotion.yml` pins the digest in
  `projects/homelab/services/tapes/release.json`. The homelab deploys it; see
  [projects/homelab/docs/tapes.md](../homelab/docs/tapes.md).
