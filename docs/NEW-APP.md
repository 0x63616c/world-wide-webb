# Start an independent app

There is no shared scaffold. Copy the closest living product under `projects/`
(Tendr for a standard iOS app, or another peer if you need its backend shape),
then rename the folder, display name, bundle ID, schemes and site paths.

1. Copy `projects/<source>/` to `projects/<slug>/` and update `app.yml`,
   XcodeGen/`project.yml`, listing metadata and any site pages so they name the
   new product only.
2. Register CI ownership in [`scripts/ci/units.json`](../scripts/ci/units.json)
   the same way the source app does. Add a public landing card in
   [`sites/index.html`](../sites/index.html) and `sites/.pages` only when the
   product has a public site.
3. Run `scripts/dev setup <slug>` and `scripts/dev check <slug>`. Keep UI,
   fixtures, screenshots and backends with the product; shared delivery stays in
   root `fastlane/` and CI selection.
4. Before enabling TestFlight, establish Apple records, signing, a real
   `apple_id`, listing URLs and a signed processed internal beta. Set `testflight`
   only after that path works. Use the [release guide](RELEASE.md).

Use [development](DEVELOPMENT.md) for worktrees and local checks. Copying a live
app keeps one source of truth for delivery wiring; do not reintroduce
`templates/`.
