# Native iPad/iPhone delivery

A successful push-to-main **CI** run triggers **Apple Panel TestFlight**. Its selection artifact
publishes only when shipping native sources/configuration changed; documentation, server-only and
test-only changes do not publish another app build. PRs never receive production signing credentials.

Native CI and upload use hosted `xcode-27` with `/Applications/Xcode_27.2.app/Contents/Developer`.
The release lane rejects another Xcode version before signing, so an older SDK cannot silently
ship a compatibility-sized Duo app. Build 173 used Xcode 26.6 despite containing Duo layouts.

The upload job checks out the exact successful CI revision, uses Xcode 27.2, loads signing
credentials once from SOPS, and runs `apple/fastlane/Fastfile` through Bundler. Existing bundle IDs,
marketing version and App Store Connect application are preserved. Mac/Vision compatibility is disabled.
No API credentials are included in the app; devices connect through Tailscale.

The lane archives/signs the app, uploads and waits for Apple processing. Only a processed build gets a
revision/build receipt and is published to native clients through the private Tailscale API. A retry reuses a matching
processed receipt, avoiding duplicate uploads. Do not treat compilation or an accepted upload as proof
of processing. Never bypass required CI checks.

For local work, boot an iPad simulator and run `python3 scripts/panel-dev.py` for incremental build/install.
`bash tools/test_apple.sh` builds the shared target, runs iPad units and iPhone platform checks.
The `Panel` scheme also includes UI tests; run focused UI cases with Xcode when interactions change.
`python3 scripts/panel-release-status.py <run-id>` reports workflow queues and step timings without
reading signing logs. Hosted runner wait, compilation, upload and processing are separate delays.

Signing profiles and release credentials remain in the existing secret store. Do not revoke shared
certificates or regenerate profiles as routine cleanup. Keep uploaded receipts and deployment history;
remove only disposable local derived data and build caches when no process uses them.

Backend releases use the existing homelab owner: CI publishes the tested immutable image,
**Promote Control Center image** commits its digest to
`homelab/services/control-center/release.json`, and Homelab CI/promotion plus the mini updater
activate it. A repository deploy key lets the pin commit trigger normal CI. Neither app
publication nor backend promotion requires a temporary migration enablement variable.

Processed-build publication uses the existing scoped homelab operations Tailscale identity
and `PANEL_ALARMS__TOKEN` directly inside SOPS. It calls the private HTTPS API and no longer
SSHs into the retired host/user or relies on a copied publication script.
