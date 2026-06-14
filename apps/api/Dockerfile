# syntax=docker/dockerfile:1

# ── Stage 1: bundle the server into a single file ────────────────────────────
# The full workspace install lives ONLY in this stage; it is discarded. We emit
# one self-contained JS bundle (server + tRPC + drizzle + pg), so the runtime
# image ships no node_modules and no build toolchain (drizzle-kit, typescript).
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full graph for the bundler.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/media-worker/package.json apps/media-worker/
COPY packages/api/package.json packages/api/
COPY packages/logger/package.json packages/logger/
COPY packages/platform/package.json packages/platform/
COPY products/amp/package.json products/amp/
COPY products/captive-portal/apps/api/package.json products/captive-portal/apps/api/
COPY products/captive-portal/apps/frontend/package.json products/captive-portal/apps/frontend/
COPY products/captive-portal/package.json products/captive-portal/
COPY products/control-center/api/package.json products/control-center/api/
COPY products/control-center/ios/package.json products/control-center/ios/
COPY products/control-center/media-worker/package.json products/control-center/media-worker/
COPY products/control-center/package.json products/control-center/
COPY products/control-center/storybook/package.json products/control-center/storybook/
COPY products/control-center/web/package.json products/control-center/web/
COPY products/control-center/worker/package.json products/control-center/worker/
COPY products/text-your-ex/package.json products/text-your-ex/
# Infra Pulumi workspaces (www-j934.1/.2/.3): root package.json declares these, so
# bun install needs their manifests in the build context (www-272b).
COPY infra/package.json infra/
COPY infra/cloudflare/package.json infra/cloudflare/
COPY infra/unifi/package.json infra/unifi/

# --ignore-scripts skips the lefthook prepare hook (needs git, absent here).
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY packages packages

# Bundle to a single file. server.ts runs migrations on boot via drizzle-orm's
# runtime migrator, so drizzle-kit never ships.
RUN bun build apps/api/src/server.ts --target=bun --outfile dist/server.js

# Second entrypoint: the portal data-hygiene purge (www-q002.18). Bundled into
# the same image so the bosun cronJob runs it via a command override
# (`bun purge.js`); it shares the api's drizzle schema + DATABASE_URL wiring.
RUN bun build apps/api/src/purge.ts --target=bun --outfile dist/purge.js

# The worker is a SEPARATE app + image now (apps/worker, control-center-worker),
# no longer bundled here (www-xjba). The api ships server.js only.

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle and the SQL migration files. bun is the runtime; alpine keeps
# a shell for on-box debugging of the wall panel.
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

COPY --from=build /app/dist/server.js server.js
COPY --from=build /app/dist/purge.js purge.js
# Migrations resolve relative to the bundle's own location (import.meta.url),
# i.e. /app/migrations at runtime, keep this path in sync with WORKDIR.
COPY --from=build /app/apps/api/src/db/migrations migrations

EXPOSE 4201

CMD ["bun", "server.js"]
