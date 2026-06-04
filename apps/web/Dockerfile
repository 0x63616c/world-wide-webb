# syntax=docker/dockerfile:1

# ── Stage 1: build the Vite static bundle ────────────────────────────────────
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy manifests first so the layer cache survives pure source changes.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/bosun/package.json packages/bosun/

# Install all workspace deps (prod + dev; we need the build tools).
RUN bun install --frozen-lockfile

# Copy source — apps/web needs packages/bosun types transitively.
COPY apps/web apps/web
COPY apps/api apps/api
COPY packages packages

# Build the static bundle into apps/web/dist.
RUN bun run --cwd apps/web build

# ── Stage 2: serve with nginx + reverse-proxy /trpc → api ────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx config; replace with ours.
RUN rm /etc/nginx/conf.d/default.conf

# Nginx config: serve /dist, proxy /trpc to the api service in the swarm.
# API_HOST is injected at runtime via envsubst; default keeps dev workable.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# envsubst rewrites the template at container start so API_HOST is dynamic.
ENV API_HOST=api
ENV API_PORT=4201

EXPOSE 80

# Use the official nginx entrypoint (handles envsubst via templates/).
CMD ["nginx", "-g", "daemon off;"]
