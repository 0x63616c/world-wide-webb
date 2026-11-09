# New app

Run `scripts/new-app.sh Samplr samplr` from the repository root. The first argument is the display/product name; the second is the suffix for `com.calumwebb.<suffix>`. The slug is the lowercase name.

The template creates an XcodeGen iPhone project with RDesign, Home/Settings, privacy/support links, an icon and launch glyph, a screenshot UI test, app.yml, metadata, frame configuration and site pages. If XcodeGen is installed it generates the project immediately; otherwise run it later inside the app directory.

Replace placeholder icons and copy, implement the app, and review its privacy policy. Create the App Store Connect record and internal group manually, fill in `apple_id`, review `profile_name`, and enable TestFlight only after signing and release setup. New apps are discovered automatically by the path filter. Run the root checks and a simulator build before release.
