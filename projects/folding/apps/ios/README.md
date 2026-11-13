# Apple build foundation

Generate `Folding.xcodeproj` from the tracked `project.yml` using the pinned XcodeGen. The generated project is ignored; changes belong in the specification. The target links the local FoldingKit package and runs an app-hosted persistence test on the pinned iPhone Duo simulator.

```sh
scripts/bootstrap --apple
bundle exec fastlane ios verify
```

`verify` runs the repository's core/contract checks and the simulator check. `verify_app` runs just the latter when core evidence is already current. Fastlane stores its `.xcresult` and reports under `build/test-results`. `tool-versions.json` records observed toolchain versions; the Apple lane verifies the exact Xcode build, Swift compiler, SDK, generator and available Duo runtime. It selects an installed matching simulator without committing a machine-specific UDID.

The current app is explicitly a **development launch harness**, not the product UI. A Release compilation error prevents accidentally archiving it. Replace it with the real app composition after integrating account resolution, setup/intent recording and screens; remove that guard only with the associated release acceptance checks. Bundle IDs follow the agreed plan but are not yet claimed as registered with Apple. There are no signing certificates, team defaults, production entitlements or upload lanes in this batch.

Fastlane and Ruby are pinned in `Gemfile`/`Gemfile.lock`; dependency resolution is frozen during Apple bootstrap. No external Swift packages are used, so there is no resolved dependency lockfile yet. Add one when an external dependency is introduced rather than inventing an empty lockfile.

The unprivileged GitHub `Checks` workflow defines contract validation but is dispatch-only: the owner deferred CI while arranging runners. Do not trigger it until that deferral is lifted. Native CI is still pending: on November 7 the hosted Xcode 27 image lists Xcode 27.2 **27B48**, while the verified local toolchain is **27B52**, and its Duo runtime is 27.1. Do not claim native hosted checks or downgrade the target to make a workflow green. Configure a matching hosted image or an appropriately isolated runner before enabling native CI/release automation. Runner inventory at this checkpoint had no repository self-hosted runners.

Runner reference: [Xcode 27 hosted image](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md).
