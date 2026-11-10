# Public websites

Tendr's canonical website is **https://tendr.worldwidewebb.co/**, with
[privacy](https://tendr.worldwidewebb.co/privacy/) and
[support](https://tendr.worldwidewebb.co/support/) pages. Source and content live in `sites/tendr`.
Folding publishes separately from `sites/folding` to `https://getfolding.app`.

## Build and verify

```sh
scripts/build-site.sh /tmp/public-pages-preview
python3 scripts/test-publish-site.py
node sites/folding/build.mjs
```

`sites/.pages` lists approved static roots. The builder rejects unexpected files and symlinks;
Folding's Worker source, tooling, configuration and documentation stay outside that artifact.
New-app scaffolding registers a static root; registration does not provision hosting.

## Tendr publication

The `Sites` workflow runs within repository CI. Pull requests verify and retain the static artifact;
selected main pushes publish its tested `tendr/` directory through `scripts/publish-site.sh`.
The workflow skips superseded site source; the publisher rebuilds and compares the entire artifact
before uploading. It fails on missing
credentials or deployment errors. There is no additional enablement flag.

`sites/tendr.wrangler.jsonc` configures the asset-only `tendr-web-production` Worker, with
Wrangler pinned in `sites/tendr-tools.json`. `TENDR_SITE_DEPLOY_TOKEN` has account-scoped Workers
Scripts Write permission (Cloudflare does not scope this permission to a single Worker).
`CLOUDFLARE_ACCOUNT_ID` is the existing repository variable. Recovery credentials live in
1Password's Development vault as `Tendr website CI deployment`; token values never enter source.

OpenTofu's existing encrypted `infra/cloudflare/home` state owns only the hostname's DNS and
Worker route. Wrangler owns code/assets; its configuration does not change routes or DNS.
To publish manually from verified source using the primary credential session:

```sh
scripts/build-site.sh /tmp/tendr-public-site
scripts/publish-site.sh /tmp/tendr-public-site
```

Check `/`, `/privacy/`, `/support/` and a linked stylesheet/image on the canonical host after
publication. Unknown paths return 404. The old `0x63616c.github.io/apps/tendr/` host was deleted;
new hosting cannot repair links embedded in previously installed builds.

## Folding publication

`FOLDING_SITE_DELIVERY_ENABLED` controls Folding publication. Its publisher retains its own
`FOLDING_DEPLOY_TOKEN`, Wrangler configuration/version and tested artifact. OpenTofu retains
Folding's DNS/resource ownership. Tendr publication does not deploy Folding or its API.
