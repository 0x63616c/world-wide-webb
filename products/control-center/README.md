# Control Center product boundary

Product boundary for the home dashboard, API, workers, Storybook host, Drizzle wrapper, map provisioner, and hosted iOS kiosk shell.

For www-jtp0.7.2, runtime source remains in the legacy `apps/*` locations and the product packages in this folder are compatibility wrappers. That keeps production behavior, Docker contexts, hostnames, database wiring, and traffic unchanged while giving later M7 tickets a stable product path to target.

Removal path:

1. Update CI, Docker, local dev, and infra to consume `products/control-center/*`.
2. Move source from each `legacyPath` in `product.json` into its matching `productPath`.
3. Delete the compatibility wrappers and old `apps/*` paths after product-owned builds and deploys are green.

Shared code stays shared. `packages/logger` remains platform-owned, and `packages/api` remains the browser-safe type bridge for the web bundle.
