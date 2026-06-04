# syntax=docker/dockerfile:1

# ── Stage 1: install production deps ─────────────────────────────────────────
FROM oven/bun:1-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/bosun/package.json packages/bosun/

# Production deps only; dev tools (drizzle-kit, types) are excluded at runtime
# because drizzle-kit is a devDependency — the migrate script uses it via bunx.
RUN bun install --frozen-lockfile

# ── Stage 2: copy source + build artefacts ───────────────────────────────────
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules 2>/dev/null || true

COPY package.json bun.lock ./
COPY apps/api apps/api
COPY packages packages

# Bun runs TypeScript natively; no compile step needed.
# drizzle-kit migrate runs once at start; Swarm crash-backoff handles postgres ordering.
# (depends_on is ignored by docker stack deploy, so we rely on retry loops.)
EXPOSE 4201

CMD ["sh", "-c", "bunx --cwd apps/api drizzle-kit migrate && bun run apps/api/src/server.ts"]
