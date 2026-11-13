# Start an independent app

Use the shared scaffold when a new iOS product needs its own source, tests,
listing and website placeholder. From the repository root:

Run `scripts/dev setup <project>` after creating it to install local tools.

```sh
scripts/dev new Samplr samplr
# Only when the product needs a backend:
scripts/dev new Cloudr cloudr --backend cloudflare
```

The display name becomes a lowercase folder under `projects/`; the suffix forms the bundle ID
(`com.calumwebb.samplr` in the first example). The scaffold creates an app-local
SwiftUI/XcodeGen project, starter screens, a synthetic screenshot test, `app.yml`,
listing configuration and privacy/support page placeholders. It registers the app
with CI selection and `sites/.pages`. It generates the Xcode project if XcodeGen
is installed. TestFlight starts disabled.

The optional Cloudflare preset adds an app-local TypeScript Worker, a Bun lockfile,
staging/production configuration and health tests. Its generated backend README
explains resources and first delivery. A backend is not needed for an offline app.

## Turn the scaffold into a product

1. Replace the starter screens and public page placeholders with the real user
   journey, data handling, support details and accessibility behavior.
2. Keep components, domain tests, fixtures and screenshots with the app. Run
   `scripts/dev check <project>`; it checks the declared package and unsigned
   simulator build. For a backend, it also runs its frozen install, tests and
   environment bundles.
3. Verify the app's own site and release metadata. New app registration selects
   checks; it does not create Apple records, provision Cloudflare resources or
   publish a release.
4. Before enabling automatic TestFlight, establish bundle IDs and capabilities,
   App Store Connect app/group, signing, a real `apple_id`, listing URLs and a
   signed processed internal beta. Set the app's `testflight` flag only after that
   path works. Use the [release guide](RELEASE.md) for channel behavior.

Use [development](DEVELOPMENT.md) for worktrees and local checks. A template CI
build proves the scaffold compiles; it does not establish signing or account setup
for a new product.
