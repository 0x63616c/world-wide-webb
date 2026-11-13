# Calum’s apps

Native Apple apps, shared design, and their websites. This repository is still named `tendr`; the planned rename to `apps` is documented in [docs/RENAME.md](docs/RENAME.md).

| App | Source | Bundle ID | Core tests |
| --- | --- | --- | --- |
| Tendr | [apps/tendr](apps/tendr) | `com.calumwebb.still` | `swift test --package-path apps/tendr` |

[packages/RDesign](packages/RDesign) provides the black, white and graphite palette, type, spacing, cards, rows, info popovers, settings links, splash and optional StoreKit tip jar. Its `rframe` executable renders App Store screenshot frames on macOS. `swift test --package-path packages/RDesign` also runs its portable tests on Linux.

Native builds require macOS and Xcode 26.2 or later. Tendr uses XcodeGen 2.44.1: run `xcodegen generate` inside the app directory after changing `project.yml`. Open `Still.xcodeproj` with the `Still` scheme. Simulator builds use `CODE_SIGNING_ALLOWED=NO`.

Shared release commands run from the repository root with `app:<slug>`; see [docs/RELEASE.md](docs/RELEASE.md). CI selects changed apps using `scripts/affected --intent verify`.

## macOS CI

All macOS CI runs on GitHub-hosted `xcode-27` runners with Xcode 27.1 selected explicitly at `/Applications/Xcode_27.1.app/Contents/Developer`. Workflows do not read the legacy `MACOS_RUNNER` or `DEVELOPER_DIR` repository variables. Simulator captures use iOS 27.0 (iPhone 17, or iPhone 18 Pro Max for 1320×2868 App Store captures); Duo uses iOS 27.1. Native builds use generic simulator destinations. macOS jobs allow 60 minutes on the smaller hosted machines.

[scripts/setup-mac-runner.sh](scripts/setup-mac-runner.sh) remains optional legacy setup for a local/self-hosted Mac. Its repository-variable options do not select runners or Xcode for this repository's CI.

```sh
ruby scripts/check-release.rb
python3 -m pip install -r scripts/requirements.txt
python3 scripts/test-changed-apps.py
(shopt -s nullglob; shellcheck scripts/*.sh apps/*/scripts/*.sh)
actionlint
```

Historical apps-root snapshot. For a new product today, follow [docs/NEW-APP.md](../../NEW-APP.md) (copy a living app). [docs/IMPORT.md](docs/IMPORT.md) describes history-preserving imports. [site/README.md](site/README.md) covers Pages previews and publication.

Keep changes focused. Use synthetic screenshot fixtures. Never commit signing assets, credentials, or personal health data. Core or Linux checks do not prove native UI correctness, signing, or TestFlight availability. See [AGENTS.md](AGENTS.md) for working rules and [docs/VERIFICATION.md](docs/VERIFICATION.md) for migration evidence.
