# Calum’s apps

Native Apple apps, shared design, and their websites. This repository is still named `tendr`; the planned rename to `apps` is documented in [docs/RENAME.md](docs/RENAME.md).

| App | Source | Bundle ID | Core tests |
| --- | --- | --- | --- |
| Tendr | [apps/tendr](apps/tendr) | `com.calumwebb.still` | `swift test --package-path apps/tendr` |
| Blockr | [apps/blockr](apps/blockr) | `com.calumwebb.blockr` | `swift test --package-path apps/blockr` |
| Air Miles | [apps/airmiles](apps/airmiles) | `com.calumwebb.airmiles` | `swift test --package-path apps/airmiles` |

[packages/RDesign](packages/RDesign) provides the black, white and graphite palette, type, spacing, cards, rows, info popovers, settings links, splash and optional StoreKit tip jar. Its `rframe` executable renders App Store screenshot frames on macOS. `swift test --package-path packages/RDesign` also runs its portable tests on Linux.

Native builds require macOS and Xcode 26.2 or later. Tendr and Blockr use XcodeGen 2.44.1: run `xcodegen generate` inside the app directory after changing `project.yml`. Open the app’s `.xcodeproj`; schemes are `Still` and `Blockr` respectively. Simulator builds use `CODE_SIGNING_ALLOWED=NO`. Blockr also has a `BlockrMac` scheme; its [README](apps/blockr/README.md) documents the Mac content filter, iCloud switch and current distribution-signing blocker. Blockr uses Xcode 27.

Shared release commands run from the repository root with `app:<slug>`; see [docs/RELEASE.md](docs/RELEASE.md). CI selects changed apps using `scripts/affected --intent verify`. `MACOS_RUNNER` may be a runner label or a JSON label array; the default is `macos-latest`. `DEVELOPER_DIR` defaults to `/Applications/Xcode_26.2.app/Contents/Developer`. Override it when the selected runner installs a newer supported Xcode elsewhere.

```sh
ruby scripts/check-release.rb
python3 -m pip install -r scripts/requirements.txt
python3 scripts/test-changed-apps.py
(shopt -s nullglob; shellcheck scripts/*.sh apps/*/scripts/*.sh)
actionlint
scripts/new-app.sh Samplr samplr
```

[scripts/new-app.sh](scripts/new-app.sh) creates a native app and Pages skeleton from [templates/new-app](templates/new-app). [docs/IMPORT.md](docs/IMPORT.md) describes history-preserving imports. [site/README.md](site/README.md) covers Pages previews and publication.

Keep changes focused. Use synthetic screenshot fixtures. Never commit signing assets, credentials, or personal health data. Core or Linux checks do not prove native UI correctness, signing, or TestFlight availability. See [AGENTS.md](AGENTS.md) for working rules and [docs/VERIFICATION.md](docs/VERIFICATION.md) for migration evidence.
