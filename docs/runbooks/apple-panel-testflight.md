# Native Panel TestFlight upload

Run **Apple Panel TestFlight** manually from Actions on `main`. It uses the
Fastlane lane from `main` and the native sources from the supplied `ref` (default
`WWW-8-apple-prototype`). The selected ref must contain the hybrid `Panel` target;
until WWW-18 merges, use `WWW-18-hybrid-shell`. Only dispatch trusted source refs:
the native build runs in the protected `production` environment with signing and
panel credentials.

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
