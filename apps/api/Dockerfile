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
COPY packages/api/package.json packages/api/
COPY packages/bosun/package.json packages/bosun/

# --ignore-scripts skips the lefthook prepare hook (needs git, absent here).
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY packages packages

# Bundle to a single file. server.ts runs migrations on boot via drizzle-orm's
# runtime migrator, so drizzle-kit never ships.
RUN bun build apps/api/src/server.ts --target=bun --outfile dist/server.js

# The worker is a SEPARATE app + image now (apps/worker, control-center-worker),
# no longer bundled here (CC-xjba). The api ships server.js only.

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle and the SQL migration files. bun is the runtime; alpine keeps
# a shell for on-box debugging of the wall panel.
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

COPY --from=build /app/dist/server.js server.js
# Migrations resolve relative to the bundle's own location (import.meta.url),
# i.e. /app/migrations at runtime — keep this path in sync with WORKDIR.
COPY --from=build /app/apps/api/src/db/migrations migrations

EXPOSE 4201

CMD ["bun", "server.js"]
