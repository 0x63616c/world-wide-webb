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

### ios register_ids

```sh
[bundle exec] fastlane ios register_ids
```

Register an app's bundle IDs with App Groups via the API key and report its app record (app groups themselves need the developer website)

### ios testers

```sh
[bundle exec] fastlane ios testers
```

Ensure ASC users are testers in the app's internal TestFlight group

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

### ios screenshots

```sh
[bundle exec] fastlane ios screenshots
```

Capture App Store screenshots with snapshot (iPhone 18 Pro Max and iPhone Duo, light and dark), then frame and stage them with the app's rframe tool

### ios distribute_existing

```sh
[bundle exec] fastlane ios distribute_existing
```

Assign an already processed build to the app's TestFlight group

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Test, build, upload, wait, and distribute the next internal beta

### ios plan_release

```sh
[bundle exec] fastlane ios plan_release
```

Plan an automatic update, reusing a pipeline-owned waiting version

### ios check_release_source

```sh
[bundle exec] fastlane ios check_release_source
```

Skip expensive capture when a newer eligible main merge has superseded this run

### ios finish_release

```sh
[bundle exec] fastlane ios finish_release
```

Verify replacement evidence, replace a waiting bundle, and submit the exact build

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload the App Store listing and screenshots. Never uploads a binary or submits for review

### ios select_build

```sh
[bundle exec] fastlane ios select_build
```

Attach the explicit processed, unexpired TestFlight build to the App Store version

### ios ensure_free_pricing

```sh
[bundle exec] fastlane ios ensure_free_pricing
```

Make the app free in every territory if it has no price yet. An existing price is left alone

### ios review_status

```sh
[bundle exec] fastlane ios review_status
```

Print what App Store Connect currently has for the editable version

### ios age_rating

```sh
[bundle exec] fastlane ios age_rating
```

Answer the age rating questionnaire: nothing applies except the app's age_rating overrides in app.yml

### ios review_detail_check

```sh
[bundle exec] fastlane ios review_detail_check
```

Make sure App Review does not expect a demo account

### ios tip_iaps

```sh
[bundle exec] fastlane ios tip_iaps
```

Create or update the app's consumable tips (name, price, availability, review screenshot). Never submits

### ios submit_with_iap

```sh
[bundle exec] fastlane ios submit_with_iap
```

Submit the exact build with all ready IAPs/subscriptions, preserving existing prices and products

### ios prepare_review

```sh
[bundle exec] fastlane ios prepare_review
```

Upload the listing and screenshots, set Free pricing and attach build:<number>. Stops before Submit for Review

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
