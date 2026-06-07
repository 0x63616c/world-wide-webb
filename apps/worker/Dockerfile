# syntax=docker/dockerfile:1

# ── Stage 1: bundle the worker into a single file ────────────────────────────
# Same shape as apps/api/Dockerfile, but the entrypoint is the worker app. The
# worker imports its domain cycles from @repo/api, so this stage needs the api
# source too; bun bundles the whole graph into one self-contained JS file, so the
# runtime image ships no node_modules and no build toolchain (CC-xjba).
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full graph for the bundler.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api/package.json packages/api/
COPY packages/bosun/package.json packages/bosun/

# --ignore-scripts skips the lefthook prepare hook (needs git, absent here).
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages

# Bundle to a single file. index.ts runs migrations on boot via drizzle-orm's
# runtime migrator (re-exported from @repo/api), so drizzle-kit never ships.
RUN bun build apps/worker/src/index.ts --target=bun --outfile dist/worker.js

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle and the SQL migration files. bun is the runtime; alpine keeps
# a shell for on-box debugging.
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

COPY --from=build /app/dist/worker.js worker.js
# Migrations resolve relative to the bundle's own location (import.meta.url),
# i.e. /app/migrations at runtime — keep this path in sync with WORKDIR. They
# live in apps/api (the schema's home) and are re-exported via @repo/api.
COPY --from=build /app/apps/api/src/db/migrations migrations

# No port: the worker serves no HTTP, it only reaches out to HA + Postgres.
CMD ["bun", "worker.js"]
