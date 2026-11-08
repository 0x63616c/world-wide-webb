# Later rename: tendr → apps

No repository rename or remote publication is part of this migration. Until authorized, the repository remains `0x63616c/tendr`, and Tendr keeps these exact live URLs in its app and listing:

- https://0x63616c.github.io/tendr/privacy/
- https://0x63616c.github.io/tendr/support/

`scripts/build-site.sh` and `scripts/publish-site.sh` mirror `site/tendr` at the Pages root while `site/.legacy-root` contains `tendr`. The same content also exists under `/tendr/tendr/`. Preview locally with `scripts/build-site.sh /tmp/apps-pages-preview` (the directory must be empty).

When the rename is authorized:

1. Rename `0x63616c/tendr` to `0x63616c/apps` on GitHub. Update this checkout’s origin to `https://github.com/0x63616c/apps.git` and check branch protection, Actions secrets, runner variables, Pages branch and environments.
2. Create a public stub repository named `0x63616c/tendr`. Generate its content with `scripts/make-redirect-site.sh tendr https://0x63616c.github.io/apps/tendr /tmp/tendr-redirect`. Commit that output in the stub and configure Pages to serve it. It contains meta-refresh redirects for the old home, privacy and support URLs, plus a fallback link. Do not rely on GitHub repository redirects for Pages URLs.
3. Run `scripts/post-rename.sh apps` in the monorepo. Review the diff: Tendr app/metadata links become `/apps/tendr/privacy/` and `/apps/tendr/support/`; other app URLs become `/apps/<app>/...`. It removes `site/.legacy-root` so the Pages root becomes the app index. Update any remaining app or metadata URLs before publishing.
4. Commit and merge; the `Site` workflow runs `scripts/publish-site.sh` automatically for site changes (or dispatch it manually). Confirm Pages is serving `gh-pages` at `/apps/`. The script preserves directories listed in `site/.retain` from the previous published tree when absent from the build. Built directories take priority. See `site/README.md` for publication details.
5. Check both old Tendr URLs, their redirect destinations and every app’s privacy/support pages in a browser. Update App Store metadata using the root lanes, and ship in-app link changes in later app releases. Keep the `tendr` stub indefinitely for installed versions and external links.

Creating a stub under the old name replaces GitHub’s automatic repository redirect, so update Git remotes and repository links too. Schedule the switch together; Pages propagation can create a temporary gap. No automatic script renames or creates remote repositories.
