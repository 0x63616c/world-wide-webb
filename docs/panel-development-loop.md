# Panel development and release loop

Use an existing dev worktree. Before starting a release, confirm the configured
1Password SSH signer is available with the first coherent commit; do not discover
a locked signer after waiting for CI. Never disable signing to work around it.

## Local checks

`python3 scripts/panel-dev.py` incrementally builds and reloads the booted iPad
using the developer's selected Xcode. It prints that toolchain explicitly; this
is a preview, not evidence of CI compatibility.

Before publishing native changes, run:

```sh
python3 scripts/panel-validate.py --preflight-only
python3 scripts/panel-validate.py --device <booted-iOS-26-iPad-UDID>
```

Install Xcode 26.x alongside newer development Xcodes and an iOS 26 simulator
runtime. The 12.9-inch iPad Pro (6th generation) matches CI's 1366×1024 panel.
The local validator and both Apple workflows use `.github/scripts/apple-toolchain.py`
to choose the newest installed Xcode 26.x. They never fall back to Xcode 27.
This aligns the major-version policy; exact installed patch/build versions still
appear in the logs and CI test-product reuse requires an exact toolchain match.

The validator runs all four release UI suites. Its isolated derived-data cache,
per-stage logs and timings live under `~/.local/state/world-wide-webb/panel-validation`.
The navigation helper wakes a dimmed panel first and swipes from inside the clock's
bottom 100-point interaction region. The idle-wake regression deliberately waits
for dimming; release tests are not disabled to accommodate slow runners.

## Release validation reuse

A main release may reuse successful same-repository PR smoke evidence only when
its native validation inputs match. GitHub-owned checkout logs identify the
tested commit; Git object identities compare file content, type and mode.

Inputs include all files under `apps/apple-prototype` and `apps/panel`, every
`.github/scripts/apple-*` script, and both Apple workflow files. Only files named
`README.md` and `AGENTS.md` are excluded as documentation. Other Markdown resources
still invalidate evidence. New native paths are included automatically. Missing
directories, truncated API trees, missing checkout evidence and unsuccessful jobs
fail closed and run smoke tests. No PR binaries or scripts are executed by the
signing job as evidence.

README/AGENTS-only changes do not trigger TestFlight or native platform suites.
Unrelated infrastructure changes between PR validation and squash merge no longer
invalidate otherwise-identical native evidence. App code, resources, tests,
dependencies, release lanes and workflow changes still invalidate it.

## Observe delivery

```sh
python3 scripts/panel-release-status.py <run-id> > /tmp/panel-release-timings.json
```

The report includes every attempt, runner waiting and individual step timing from
metadata only. Parallel times overlap; do not sum them into wall-clock duration.
Do not cancel queued/running jobs just because they are slow. Retry completed
capacity failures; investigate test failures before retrying. Never bypass checks.

Report request-to-ready and merge-to-ready separately. Completion means the
Fastlane log confirms Apple's processing and the actual build number, not merely
a green compile or an accepted upload. Read only filtered timing/completion lines
from signing logs, never secret values. Keep the original request timestamp through
retries so the reported elapsed time includes rework and queues.

Hosted Mac capacity is still external. Dedicated runner migration is separate work.
