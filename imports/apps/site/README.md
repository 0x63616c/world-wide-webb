# Site

One GitHub Pages site for every -r app. Each app has its own folder with a home page, privacy policy and support page:

- `site/<app>/` → `https://0x63616c.github.io/<repo>/<app>/`
- `site/<app>/privacy/` and `site/<app>/support/` → the URLs in that app's App Store listing

Plain HTML and CSS in the RDesign palette (black, white and graphite; card radius 24). Light and dark follow `prefers-color-scheme`. `scripts/new-app.sh` adds a folder from `templates/new-app/site/` and a card to `site/index.html`.

The `Site` workflow runs `scripts/publish-site.sh` on merges to `main` that change the site or its publishing scripts. It can also be dispatched manually. It publishes to `gh-pages` and requests a Pages build; Pages serves the branch root at https://0x63616c.github.io/apps/. The script can still be run by hand when authorized.

`site/.retain` lists directories (one name per line, with `#` comment lines) to restore from the previous `origin/gh-pages` tree when the build no longer produces them. Freshly built directories always take priority. Remove retained names only with Calum's OK.

`site/.legacy-root` mirrors one app at the site root. It keeps Tendr's original URLs (`/tendr/`, `/tendr/privacy/`, `/tendr/support/`) working while this repository is still called `tendr`. Remove it as part of the rename in `docs/RENAME.md`.

Preview without publishing: `scripts/build-site.sh /tmp/apps-pages-preview` (empty output directory). Previews contain only current sources; retained pages are restored during publication. Unchanged output skips the commit and push; publication commits include `[skip ci]`.
