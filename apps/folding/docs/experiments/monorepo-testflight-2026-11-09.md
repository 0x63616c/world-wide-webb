# Folding internal TestFlight handover — November 9, 2026

## Current delivery

Native source: `cbe9b588adc7f1a871c72e7aa831dce2ca8f56fa`, merged in
[WWW #974](https://github.com/0x63616c/world-wide-webb/pull/974).
Signed **1.0.0 (15)** was archived, inspected and uploaded once. Apple reports **VALID**,
with exact build `8d769aea-ac3e-450b-808a-22c39a9bf22e` confirmed in **Folding Internal**
at `2026-11-09T17:17:52Z`. The immutable delivery receipt is recorded. No App Store
submission or external beta review was requested.

[Main Folding CI attempt 2](https://github.com/0x63616c/world-wide-webb/actions/runs/42658920807/attempts/2)
passes the exact named native, domain/storage, contracts and localization checks. Attempt 1's
Swift Testing helper crashed with signal 11, without a failed assertion; the failed job passed
on retry while successful jobs were reused. The same 29 domain plus 113 data tests pass locally.
The release helper suite passes 38 tests / 683 assertions. The intermittent crash is not claimed fixed.

Readonly Match used WWW's encrypted `signing/folding` branch. Temporary signing-keychain cleanup
completed after archive. Historical reservations were imported into the authenticated draft ledger;
its previous maximum was 14. New signed artifacts/manifests remain authenticated GitHub drafts
permanently. Publishing a draft in public WWW would expose its contents.

## Backend

Production serves the exact main-CI-tested Worker `8ed02ee38473f91580c74b6466fcdf47411d334c`,
Cloudflare version `02bae348-57cd-4ba4-a04d-acc8ae55a570`. Staging and production have all
23 checksum-fenced migrations. A production recovery bookmark was retained before mutation;
existing resource/secret bindings and preview feature flags were preserved. Health, the three
required preview capabilities and the source-bound provider receipt pass the normal validator.
Native/backend normalized runtime inputs match despite different whole-repository commits.

Live staging used isolated synthetic enrollment/session/attestation fixtures to verify 18 live
plus 41 original historical folds, retry/immutable conflict handling, badge opt-in, grouped jobs,
acknowledgment and suppression. Fixture participants were removed and absence confirmed. This
is real Worker/D1 feature integration, not Apple enrollment or APNs delivery evidence. Existing
hardware, transfer/reset, purchase, notification delivery and final-store acceptance remain open.
Private runtime snapshots, overlays, recovery/receipt files and raw logs stay outside Git.

## Automation and remaining work

The existing `folding-release.yml` publisher consumes successful trusted main pushes and only
actual backend/native delivery candidates. Documentation/test-only changes do not request a beta.
`FOLDING_DELIVERY_ENABLED=true` enables future main app/backend deliveries. This first build
used the local handler while exact-source main CI ran independently; the next natural app change
will exercise the unattended runner publisher. Local and CI use the same immutable Fastlane
handler; upload ambiguity is reconciled against Apple and
sealed binaries are reused. App Store submission retains its broader explicit gates.

GitHub's [hosted image inventory](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)
includes Xcode 27.2 (27B52) and Duo/iOS 27.2 under `runs-on: xcode-27`. The earlier claim that
hosted Macs could not supply Folding's toolchain was wrong. Current homelab routing is a workflow
choice, not a GitHub availability constraint; this delivery checkpoint does not claim a hosted run.

The original Folding repository still owns legacy read-only artifacts and shipping issues. Keep
it available until those references/consumers are accounted for. The beta does not complete
all repository-retirement work or the full App Store shipping goal.
