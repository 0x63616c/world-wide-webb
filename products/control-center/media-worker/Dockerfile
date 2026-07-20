# syntax=docker/dockerfile:1

# ── Stage 1: bundle the media-worker into a single file ──────────────────────
# Mirrors products/control-center/worker/Dockerfile but ALSO installs ffmpeg + yt-dlp in the
# runtime image, the media-worker spawns these as child processes for
# playlist enumeration and AV1 video download (www-kp4k.2).
FROM oven/bun:1.2-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full dependency graph.
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
COPY products/control-center/media-worker products/control-center/media-worker
COPY packages packages

# Bundle to a single file. index.ts runs migrations on boot (re-exported from
# @control-center/api/media), so drizzle-kit never needs to ship in the runtime image.
RUN bun build products/control-center/media-worker/src/index.ts --target=bun --outfile dist/media-worker.js

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle + SQL migrations + yt-dlp + ffmpeg. bun is the runtime;
# alpine keeps a shell for on-box debugging. yt-dlp requires python3 + pip.
FROM oven/bun:1.2-alpine AS runtime

WORKDIR /app

# Install ffmpeg and yt-dlp (www-kp4k.2 AC: must be on PATH in runtime stage).
# - ffmpeg: required by yt-dlp -x (audio extraction) and AV1 muxing.
# - python3 + py3-pip: yt-dlp is a Python CLI; pip installs the latest release.
# --break-system-packages is required on Alpine's managed Python (PEP 668).
RUN apk add --no-cache ffmpeg python3 py3-pip \
 && pip3 install --break-system-packages yt-dlp \
 && yt-dlp --version \
 && ffmpeg -version | head -1

COPY --from=build /app/dist/media-worker.js media-worker.js
# Migrations resolve relative to /app at runtime, same path as worker.
COPY --from=build /app/products/control-center/api/src/db/migrations migrations

# No HTTP port: the media-worker only reaches out to Postgres + YouTube.
CMD ["bun", "media-worker.js"]
