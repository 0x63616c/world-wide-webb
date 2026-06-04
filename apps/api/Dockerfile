# syntax=docker/dockerfile:1

# ── Stage 1: install production deps ─────────────────────────────────────────
FROM oven/bun:1-alpine AS deps

WORKDIR /app

# Copy all workspace manifests so bun resolves the full workspace graph.
# apps/web is included because the root workspace references all apps/*.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/bosun/package.json packages/bosun/

# Install workspace deps. drizzle-kit is a devDep but bunx at runtime can use
# the installed copy; swarm crash-backoff handles postgres startup ordering.
# --ignore-scripts skips the lefthook prepare hook (needs git, not in alpine image).
RUN bun install --frozen-lockfile --ignore-scripts

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules node_modules

COPY package.json bun.lock ./
COPY apps/api apps/api
COPY packages packages

# Bun runs TypeScript natively; no compile step needed.
# drizzle-kit migrate runs once at start; Swarm crash-backoff handles postgres ordering.
# (depends_on is ignored by docker stack deploy, so we rely on retry loops.)
EXPOSE 4201

CMD ["sh", "-c", "bunx --cwd apps/api drizzle-kit migrate && bun run apps/api/src/server.ts"]
