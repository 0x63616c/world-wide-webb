# syntax=docker/dockerfile:1

# ── Stage 1: bundle the worker into a single file ────────────────────────────
# Same shape as products/control-center/api/Dockerfile, but the entrypoint is the worker app. The
# worker imports its domain cycles from @control-center/api, so this stage needs the api
# source too; bun bundles the whole graph into one self-contained JS file, so the
# runtime image ships no node_modules and no build toolchain (www-xjba).
FROM oven/bun:1.2-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full graph for the bundler.
COPY package.json bun.lock ./
COPY products/control-center/package.json products/control-center/
COPY products/control-center/api/package.json products/control-center/api/
COPY products/control-center/web/package.json products/control-center/web/
COPY products/control-center/worker/package.json products/control-center/worker/
COPY products/control-center/media-worker/package.json products/control-center/media-worker/
COPY products/control-center/drizzle/package.json products/control-center/drizzle/
COPY products/control-center/map-provision/package.json products/control-center/map-provision/
COPY products/control-center/ios/package.json products/control-center/ios/
COPY products/control-center/storybook/package.json products/control-center/storybook/
COPY products/captive-portal/package.json products/captive-portal/
COPY products/captive-portal/apps/api/package.json products/captive-portal/apps/api/
COPY products/captive-portal/apps/frontend/package.json products/captive-portal/apps/frontend/
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
COPY products/control-center/worker products/control-center/worker
COPY packages packages

# Bundle to a single file. index.ts runs migrations on boot via drizzle-orm's
# runtime migrator (re-exported from @control-center/api), so drizzle-kit never ships.
RUN bun build products/control-center/worker/src/index.ts --target=bun --outfile dist/worker.js

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle and the SQL migration files. bun is the runtime; alpine keeps
# a shell for on-box debugging.
FROM oven/bun:1.2-alpine AS runtime

WORKDIR /app

COPY --from=build /app/dist/worker.js worker.js
# Migrations resolve relative to the bundle's own location (import.meta.url),
# i.e. /app/migrations at runtime, keep this path in sync with WORKDIR. They
# live in products/control-center/api (the schema's home) and are re-exported via @control-center/api.
COPY --from=build /app/products/control-center/api/src/db/migrations migrations

# No port: the worker serves no HTTP, it only reaches out to HA + Postgres.
CMD ["bun", "worker.js"]
