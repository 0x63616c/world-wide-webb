# Offline cold startup and combined API protection verification

November 8, 2026. Local implementation for #57; includes the combined #55/#56 branch and safe build observability. Provider changes, updated TestFlight distribution and physical airplane-mode acceptance are not claimed.

## Reproduction and fix

The deterministic app-hosted `OfflineColdStartTests.testHistoryAndTrackingReopenWithoutAnyCloudLookup` first saved an opening, created a new connection with the cloud identity service returning `URLError.notConnectedToInternet`, and attempted to reopen the journal. Before the fix it failed with `NSURLErrorDomain -1009` before reading local history. After the fix it reads the saved fold, records the closing, and reports two folds without an additional cloud lookup.

Separate local startup from replication authorization. A successful verified account connection saves an opaque device identity witness tied to the installation and active partition lease. A matching local witness permits offline journal access without Core Data/CloudKit startup; synchronization re-verifies before attaching the mirror. Never reopen a cloud namespace based only on an installation-wide cached account name. Nil/changed/missing proof does not authorize cloud history; suspended and restored-installation grants remain fenced. Existing cloud journals must initialize this cache through one successful connection in the new build before relying on offline cold startup.

Temporary CloudKit availability notifications with unchanged local identity retain history. Actual account-change handling still fences old readers/writers. Local recording/reset no longer await competition network latency. Queued observations survive for later upload; replication can resume after connectivity returns.

## Verification

- Original reproduction: one app-hosted test failed with the no-internet error; it now passes.
- Combined clean branch: **93 Swift core tests** and **51 app-hosted simulator tests** pass, including the existing startup-sharing and background storage-lock regressions from the current main branch.
- Four offline app tests cover same-account cold reopening, unavailable cloud identity, sign-out/change fencing, restored installation rejection, suspended routes, anonymous local-only offline startup, retained personal UI/history through availability notifications, reconnection and a deliberately stalled upload that does not delay recording.
- Three data tests cover witness/lease/installation binding, journal startup without creating a mirror, later mirror attachment/pause, and nil-witness separation between local-only and cloud history.
- Backend integration retains released entry-deletion behavior. Neighbor-score baselines and bounded tombstone reads account for deleted contributions without removing causal transitions; differential full/subset replay includes deletion tombstones.
- Resource indexes use **migration 0019** because released main/production already use 0018 for entry deletions. Existing 0018 is preserved.
- Request logs include validated numeric `client_build` in structured console objects; the app sends `X-Folding-Build` on JSON, image and policy requests. Invalid values log null; no arbitrary header text or credentials are retained.

Logs/results are ignored local `build/offline-*` artifacts in the original workspace. Synthetic account markers and local mirrors exercise the real routing/runtime seams; no production credentials or actual user records were used. The code relies on Apple's local ubiquity identity marker, so actual device token behavior, airplane-mode Shortcuts execution and second-device cloud reconnection remain #47/F13 acceptance. If the OS cannot establish the account, retain data and require verification rather than expose a different account's history.

## Delivery

The combined PR starts from main's TestFlight build-11 startup/lock fixes and contains API resource controls, the default-disabled minimum-build gate and offline access. It excludes unrelated storefront/UI edits from the other workspace. Apply additive resource indexes before the updated Worker, keep the minimum disabled until a compatible app is available, then distribute the updated app through Fastlane. Existing required-update policy behavior remains owner-selected and unchanged.
