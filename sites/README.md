# Public websites

Website source stays beside the apps in this repository; each product owns its appearance.
Tendr's existing public privacy/support URLs remain under
`https://0x63616c.github.io/apps/tendr/`. Folding retains its independently deployed
Cloudflare site at `https://getfolding.app` and its staging environment.

`sites/.pages` explicitly lists static roots eligible for the legacy Pages endpoint. The
builder publishes those roots and the public index only; Folding's Worker source, build tools,
configuration and documentation are excluded. An unexpected file or symlink within an approved
static root fails the build. New-app scaffolding registers its public root in this list.

Preview into an empty directory outside `sites/`:

```sh
scripts/build-site.sh /tmp/public-pages-preview
node sites/folding/build.mjs
```

`Sites` CI selects each delivery unit independently on GitHub-hosted ARM64 Linux runners. A Folding site
change builds Folding's production/staging assets without changing Tendr or publishing an app.
The legacy Pages publisher uses a separate `0x63616c/apps` `gh-pages` checkout and scoped
`LEGACY_SITE_DEPLOY_KEY`. It compares the prepared artifact with the verified static source,
retains explicitly listed historical pages, and pushes only generated assets. Source history
never goes to that publication branch. A delayed older source cannot replace newer pages.

`LEGACY_SITE_DELIVERY_ENABLED` controls publication to the retained apps endpoint. Only WWW's
publisher owns updates once the old apps `Site` workflow is disabled. GitHub builds Pages from
the pushed `gh-pages` branch; the repository stays available for installed support/privacy URLs.

`FOLDING_SITE_DELIVERY_ENABLED` controls Folding's staging and production asset publication.
The publisher reuses `FOLDING_DEPLOY_TOKEN`, the non-secret `CLOUDFLARE_ACCOUNT_ID` variable and
the product's pinned Wrangler version. It deploys the already-built site artifacts; OpenTofu
continues owning existing DNS/routes. It does not deploy the API or change infrastructure state.

A main-branch **Run workflow** on `Sites` builds and publishes both sites when their flags are
on. Ordinary pushes publish only the site whose delivery inputs changed; pull requests build
without publishing. Use manual publication for the initial handover or a missed deployment.

`sites/.retain` preserves listed directories from the existing public branch when a new build
omits them. Fresh content wins. Remove retention only as an agreed retirement change.
`sites/.legacy-root`, when present, mirrors one explicitly public app at the endpoint root.

Keep `apps` as the legacy publication host while installed links depend on it. Archive/remove
its old source authority only after replacement delivery is proved; preserving these URLs can
require retaining the repository as a static host. A new Cloudflare URL alone cannot take over
GitHub-owned URLs. Track that exception in the migration plan before archiving or deleting.
