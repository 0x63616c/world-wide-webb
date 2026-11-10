# Public websites

Website source lives in WWW; products own their appearance. Folding publishes its production
and staging Cloudflare sites, including `https://getfolding.app`.

Tendr’s old `https://0x63616c.github.io/apps/tendr/` host was deleted with the `apps` repository
at the owner’s request. Replacement Cloudflare hosting and app/App Store URL changes are tracked
in [#1007](https://github.com/0x63616c/world-wide-webb/issues/1007). Existing installed links are
not repaired by new hosting alone. There is currently no maintained Tendr publication destination.

## Build and verify

```sh
scripts/build-site.sh /tmp/public-pages-preview
node sites/folding/build.mjs
```

`sites/.pages` lists approved static roots, currently Tendr. The builder emits only those roots
and the public index, rejecting unexpected files and symlinks. It excludes Folding’s Worker
source, build tooling, configuration and documentation. New-app scaffolding registers its
static root here; registration does not provision hosting.

`Sites` CI independently selects static and Folding asset builds. Static assets remain available
as CI artifacts while #1007 replaces publication. Historical `.retain` / `.legacy-root` assembly
support and the explicitly configured `scripts/publish-site.sh` helper remain covered by offline
fixtures; no workflow publishes to the deleted `apps/gh-pages` repository.

## Folding publication

`FOLDING_SITE_DELIVERY_ENABLED` controls production/staging publication. The publisher reuses
`FOLDING_DEPLOY_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and the product-pinned Wrangler version. It deploys
tested assets; OpenTofu retains DNS/resource ownership. This path does not deploy the API.

Ordinary main pushes publish selected Folding site changes; pull requests only verify. A manual
main-branch `Sites` dispatch builds assets and publishes Folding when its channel is enabled.
The retired legacy Pages flag/deploy key are unused and should not be restored.
