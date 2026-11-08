# Importing apps

```sh
scripts/import-app.sh owner/repo slug
scripts/import-app.sh owner/repo slug --move admin=web/slug-admin
IMPORT_URL=/path/to/full/local/clone scripts/import-app.sh owner/repo slug --branch main
```

Start with a clean committed checkout. With git-filter-repo available, the script rewrites a temporary clone under `apps/<slug>` and merges unrelated histories. Otherwise it uses a non-squashed `git subtree add`, retaining original commits as merge ancestors. It never pushes. Use complete source histories; shallow clones are insufficient.

After import, preserve bundle IDs, write `apps/<slug>/app.yml`, connect `../../packages/RDesign`, and update checked-in Xcode projects. Move public pages to `site/<slug>`, retain listing metadata under the app, and migrate CI/release entrypoints to the root. Set TestFlight false until signing and App Store configuration have been verified. Use bun for imported web apps.
