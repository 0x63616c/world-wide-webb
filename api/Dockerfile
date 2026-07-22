# syntax=docker/dockerfile:1

# ── Stage 1: bundle the server into a single file ────────────────────────────
# The full workspace install lives ONLY in this stage; it is discarded. We emit
# one self-contained JS bundle (server + tRPC + drizzle + pg), so the runtime
# image ships no node_modules and no build toolchain (drizzle-kit, typescript).
FROM oven/bun:1.2-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full graph for the bundler.
COPY package.json bun.lock ./
COPY products/control-center/package.json products/control-center/
COPY products/control-center/api/package.json products/control-center/api/
COPY products/control-center/web/package.json products/control-center/web/
COPY products/control-center/worker/package.json products/control-center/worker/
COPY products/control-center/drizzle/package.json products/control-center/drizzle/
COPY products/control-center/map-provision/package.json products/control-center/map-provision/
COPY products/control-center/ios/package.json products/control-center/ios/
COPY products/control-center/storybook/package.json products/control-center/storybook/
COPY packages/api/package.json packages/api/
COPY packages/logger/package.json packages/logger/
COPY packages/platform/package.json packages/platform/
COPY packages/worker-runtime/package.json packages/worker-runtime/
# Infra Pulumi workspaces (www-j934.1/.2/.3): root package.json declares these, so
# bun install needs their manifests in the build context (www-272b).
COPY infra/package.json infra/
COPY infra/cloudflare/package.json infra/cloudflare/
COPY infra/unifi/package.json infra/unifi/

# --ignore-scripts skips the lefthook prepare hook (needs git, absent here).
RUN bun install --frozen-lockfile --ignore-scripts

COPY products/control-center/api products/control-center/api
# The guest (captive-portal) SPA bundle (Task 4, SDD track 0): the api image
# serves it from GUEST_STATIC_DIR via the guest listener (ADR-0006), so the
# built dist-portal/ output has to be baked in here, not just the web image.
# Needs the web product's full source + tsconfig (vite.portal.config.ts,
# portal.html, src/portal/) to build.
COPY products/control-center/web products/control-center/web
COPY tsconfig.json tsconfig.json
COPY packages packages

# Bundle to a single file. server.ts runs migrations on boot via drizzle-orm's
# runtime migrator, so drizzle-kit never ships.
RUN bun build products/control-center/api/src/server.ts --target=bun --outfile dist/server.js

# Guest SPA bundle -> products/control-center/web/dist-portal/, COPYd into the
# runtime image below at /app/portal-dist (GUEST_STATIC_DIR).
RUN bun run --cwd products/control-center/web build:portal

# Second entrypoint: the portal data-hygiene purge (www-q002.18). Bundled into
# the same image so the bosun cronJob runs it via a command override
# (`bun purge.js`); it shares the api's drizzle schema + DATABASE_URL wiring.
RUN bun build products/control-center/api/src/purge.ts --target=bun --outfile dist/purge.js

# The worker is a SEPARATE app + image now (products/control-center/worker, control-center-worker),
# no longer bundled here (www-xjba). The api ships server.js only.

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle and the SQL migration files. bun is the runtime; alpine keeps
# a shell for on-box debugging of the wall panel.
FROM oven/bun:1.2-alpine AS runtime

# Git SHA of the build; CI passes --build-arg BUILD_HASH=${github.sha} (mirrors
# the web image). Absent (local docker build) it stays "dev", the env.ts
# default, so routers/health.ts reports what is actually running in prod.
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH

WORKDIR /app

COPY --from=build /app/dist/server.js server.js
COPY --from=build /app/dist/purge.js purge.js
# Migrations resolve relative to the bundle's own location (import.meta.url),
# i.e. /app/migrations at runtime, keep this path in sync with WORKDIR.
COPY --from=build /app/products/control-center/api/src/db/migrations migrations
# Guest SPA bundle; GUEST_STATIC_DIR is set to this path in the k8s WorkloadSpec.
COPY --from=build /app/products/control-center/web/dist-portal portal-dist

EXPOSE 4201

CMD ["bun", "server.js"]
