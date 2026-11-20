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

## Create the App Store Connect record

The CI App Store Connect API key cannot create app records; Apple's API has no
create-app endpoint. Use it only to register the bundle ID, then create the
record once with an Apple ID sign-in.

1. Register the bundle ID: `bundle exec fastlane ios register_ids app:<slug>`.
2. Create the record with `fastlane produce`. Read the Apple ID email and
   password from the 1Password "Apple iCloud" item into `FASTLANE_USER` and
   `FASTLANE_PASSWORD` without printing them, and run it in a visible terminal
   because Apple may ask for a two-factor code:

   ```sh
   fastlane produce create --username "$FASTLANE_USER" \
     --app_identifier co.worldwidewebb.<slug> --app_name "<Store name>" \
     --sku <slug>-001 --language en-US --platform ios \
     --skip_devcenter --team_id X9E4HG27NK
   ```

3. Run `register_ids` again. It prints `App record exists: <name> (<id>)`; put
   that id in `app.yml` as `apple_id`.

Use [development](DEVELOPMENT.md) for worktrees and local checks. Copying a live
app keeps one source of truth for delivery wiring; do not reintroduce
`templates/`.
