# Folding public site

Static HTML/CSS for `getfolding.app`, with no client JavaScript, framework, cookies, analytics, external fonts, API credentials, or signup database. Product, support, privacy, deletion, appeal and 404 pages share one template. The pages follow system light/dark appearance and reduced-motion preferences.

```sh
node apps/web/build.mjs
```

The dependency-free builder writes production assets to `apps/web/dist/` and staging assets to `apps/web/dist-staging/`. Both are ignored generated artifacts. Source content lives in `src/pages.mjs`; `build.mjs` owns the common document/navigation and response headers; `assets/` owns the stylesheet and original vector mark. Node is pinned to the repository's 26.13.0 toolchain in `package.json`.

## Deployment ownership

Wrangler publishes asset versions using `wrangler.jsonc`. Default configuration targets `folding-web-staging`; `--env production` targets `folding-web-production`. Both disable `workers.dev` and preview URLs. There is no runtime Worker script, backend JavaScript, or shared API/admin binding.

The primary agent owns authenticated deployment. OpenTofu owns durable hostname/DNS routing, including `getfolding.app`, a staging hostname, and the `www` → apex redirect. Do not add overlapping route ownership to Wrangler or provision resources through a dashboard. No DNS, routes, Workers, or Access policies were deployed by this batch.

Configuration follows Cloudflare's [static asset binding](https://developers.cloudflare.com/workers/static-assets/binding/) and [static site/404 routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/) contracts. An unmatched URL serves the actual 404 page; there is no SPA fallback. Staging sends `noindex` headers/meta and disallows crawling. Production includes canonical URLs and a sitemap.

## Launch state and follow-through

- Product availability intentionally says **Coming soon**. There is no invented App Store ID, download count, testimonial, screenshot, or fake subscription form. Replace availability with the actual approved listing URL at release.
- Support, deletion assistance and appeals open the user's email client at `support@getfolding.app`. These pages do not submit an authenticated account mutation or claim a request has been processed. Future service forms must enforce the backend authentication/deletion contracts.
- Privacy copy follows the approved 7-day avatar-original, 30-day deletion-recovery, 90-day closed-case and active-ban retention policies. Before publication, reconcile it with deployed behavior and confirm the operator's required business/contact disclosures and support-correspondence retention; these were not invented from unavailable account details.
- Source is English. App/storefront localization is separate; translated website policies are not claimed by this batch.
- The local production/staging build completed. Browser/accessibility/device review, link/config matrices, live Cloudflare routing, mailbox delivery and policy/retention verification are deferred to the owner's final review phase. No deployment or public availability is claimed.
