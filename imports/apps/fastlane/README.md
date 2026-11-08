fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios verify

```sh
[bundle exec] fastlane ios verify
```

Run the fast core test suite

### ios ui

```sh
[bundle exec] fastlane ios ui
```

Run the full end-to-end simulator suite when UI behavior changes

### ios distribute_existing

```sh
[bundle exec] fastlane ios distribute_existing
```

Assign an already processed build to Owner Preview

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Test, build, upload, wait, and distribute the next internal beta

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
