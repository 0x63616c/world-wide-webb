# Monorepo migration verification

Verified on Linux on 2026-10-10. All changes remain local on branch `monorepo`; no push, Pages publication, repository rename, App Store upload or remote mutation was performed.

| Check | Result |
| --- | --- |
| Swift 6.2: RDesign portable tests | 3 passed (frame configuration, path/appearance validation, spacing) |
| Swift 6.2: Tendr core | 34 passed |
| `ruby scripts/check-release.rb` | Passed: app selection, signing, target-specific profiles, project restoration, build numbering, test/provisioning failure gates and listing checks |
| actionlint 1.7.7 | All root workflows passed |
| ShellCheck 0.10.0 | Root and app shell scripts passed |
| Job timeout audit | Every root workflow job has `timeout-minutes` |
| `python3 scripts/test-changed-apps.py` | Passed: initial push, no changes, docs, app, shared, site, cross-app rename |
| XcodeGen 2.44.1 | Built on Linux; generated Tendr and a temporary scaffold project |
| Scaffold | Placeholder substitution, generated project/package reference and duplicate-name rejection passed |
| Import helper | Local fixture imported with original ancestor reachable; admin relocation passed |
| Pages preview | Original Tendr privacy/support documents mirrored at root; all app pages present; redirect stub generated |
| Live Tendr pages | Read-only HTTP checks returned 200 for existing `/tendr/privacy/` and `/tendr/support/` URLs |
| `git diff --check` | Passed |

Swift and actionlint were installed under `/tmp`; Ruby and ShellCheck were installed for these checks. Swift caches were redirected into `/tmp`. The Linux-built XcodeGen binary was invoked directly from the repository root with `--spec`; invoking it through PATH from a temporary scaffold directory hit a Linux Foundation bundle lookup crash. The direct invocation successfully generated the projects.

Still requires macOS/Xcode 26.2+ or Actions:

- Compile SwiftUI, StoreKit, AppKit/rframe and all iOS targets.
- Run simulator UI/StoreKit tests and inspect launch screens and regenerated screenshots.
- Execute path-selected Actions jobs on the configured runner and verify Apple signing, processing and internal-group distribution.
- Publish the staged Pages layout when authorized. Test the rename/redirect switch only when the repository rename is authorized.

Passing these Linux checks does not prove TestFlight availability.

## APP-22 tooling verification

Verified on Linux on 2026-11-01. Each command below exited 0:

- `ruby scripts/check-release.rb`
- `python3 scripts/test-changed-apps.py`
- `python3 scripts/test-duo-screenshots.py` (16 tests)
- `python3 scripts/test-publish-site.py`
- `build/tools/bin/actionlint` (1.7.7, installed with `go install -p 4 github.com/rhysd/actionlint/cmd/actionlint@v1.7.7`)
- `(shopt -s nullglob; shellcheck scripts/*.sh apps/*/scripts/*.sh)`
- `bash -n` individually on `scripts/import-app.sh`
- `ruby -c scripts/check-release.rb`
- `git diff --check`

Ruby 3.3.8 was extracted under ignored `build/tools` for these checks; shared system configuration was unchanged. App discovery at that checkpoint listed two apps; only Tendr remains. The retired app names have no remaining tracked-content matches. No files under `site/` changed. Swift tests, native builds, simulator screenshots and Apple service checks were not run on this Linux box; Swift and Xcode are unavailable.
