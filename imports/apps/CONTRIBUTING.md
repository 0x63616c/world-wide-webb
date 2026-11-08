# Contributing

Use Conventional Commit PR titles, for example `feat(app): add thing`. Include Summary, Changes and Testing.

UI PRs include screenshots made from synthetic fixture data, never real health data. For apps with `pr_screenshot_test` in `app.yml` (Tendr: `StillUITests/PRScreenshotTests`, using the `--demo --screenshots` fixture), the PR screenshots workflow captures the screens on the Mac runner and posts them as a PR comment; extend that test when a PR changes a screen it does not cover. Other apps attach simulator screenshots of the changed screens from their demo fixture by hand. Re-run with `gh workflow run pr-screenshots.yml -f app=<app> -f pr=<number>`.

For design work on a single component (a row, card or chip), render it instead of the whole app: add a test to the app's snapshot target (Tendr: `apps/tendr/StillSnapshots`) that calls `ComponentGallery.render` with fixture data and one `Variant` per option. It writes a light/dark comparison sheet plus one PNG per variant. Run `scripts/capture-snapshots.sh <app>` on a Mac, or `gh workflow run component-snapshots.yml --ref <branch> -f app=<app>` and download the artifact.

Read [AGENTS.md](AGENTS.md) for project conventions and [README.md](README.md) for the relevant checks. Keep changes focused and use synthetic fixtures; never commit credentials, signing assets or personal health data.
