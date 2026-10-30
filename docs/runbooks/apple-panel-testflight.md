# Native Panel TestFlight upload

Run **Apple Panel TestFlight** manually from Actions on `main`. It uses the
Fastlane lane from `main` and the native sources from the supplied `ref` (default
`main`). Only dispatch trusted source refs:
the native build runs in the protected `production` environment with signing and
panel credentials.

Before signing, archiving or uploading, a separate secret-free `smoke` job builds
`Panel-Smoke` in Debug (the existing suite uses Debug-only fixtures) for the 1366x1024 iPad Pro simulator and runs only
`PanelUITests/HomeViewLaunchTests/testHomeClassicAndReturn` from WWW-64. It asserts
`native-home`, the replacement Home face/tile identifiers, panel dimensions, and
Classic navigation/return. A missing test class
also fails the gate, so a ref predating WWW-64 cannot silently pass an empty suite.
The upload job needs smoke success and checks out its exact tested commit SHA.
The `.xcresult` and build/test logs are retained as `panel-launch-smoke` artifacts.

To verify without uploading, dispatch with `smoke_only: true`; the production job
is skipped entirely, including vault decryption and signing. Pull requests that
change this workflow or Panel sources also run only the simulator check, as do
matching pushes to `main` to populate the release cache. Compiled simulator test
products are cached by the complete native source tree, Xcode build and runner
architecture, with no partial-key fallback; the UI tests always run on a fresh
simulator. Source/toolchain changes require a cold build. On Linux,
use these Actions runs for validation; no local Xcode build is available. The
single launch test, early simulator boot and cached test products target a two-minute
release gate. Cold compilation takes longer; check actual runner timings rather
than treating two minutes as a guaranteed cold-build SLA.

The workflow selects the newest installed Xcode 26.x and checks the Panel iOS
deployment target against its SDK. A newer SDK/API requirement requires updating
the runner/toolchain. XcodeGen generates `WorldWideWebb.xcodeproj`; the release lane
manually signs only `Panel` for team `X9E4HG27NK`, overriding the prototype's
unsigned default. Runtime configuration is written to `Hybrid/Config/Secrets.xcconfig`
from the same SOPS vault entries as the Expo upload and removed after the build.

Uploads go to the existing `co.worldwidewebb.theworkflowengine` TestFlight app,
using the Expo config's marketing version and the latest TestFlight build number
plus one (initial baseline 48). This replaces the Expo shell when installed on the
wall. Coordinate with the manual **iOS Build** workflow: they share a bundle ID
and build-number sequence, so do not run both uploads simultaneously.

Leave `regenerate_profiles` off for routine uploads. Enable it once after an App
ID capability change to refresh the main app's provisioning profile. This lane
never submits for review or distributes to external tester groups. To roll back
to Expo, dispatch **iOS Build** instead.

The upload requires CI-only credentials and a macOS runner. Local YAML/Ruby
validation does not prove archive signing or App Store Connect acceptance; the
first authorized manual run validates those paths.
