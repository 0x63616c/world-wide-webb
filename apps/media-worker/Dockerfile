# syntax=docker/dockerfile:1

# ── Stage 1: bundle the media-worker into a single file ──────────────────────
# Mirrors apps/worker/Dockerfile but ALSO installs ffmpeg + yt-dlp in the
# runtime image — the media-worker spawns these as child processes for
# playlist enumeration and AV1 video download (www-kp4k.2).
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Copy every workspace manifest so bun resolves the full dependency graph.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/media-worker/package.json apps/media-worker/
COPY packages/api/package.json packages/api/
COPY packages/bosun/package.json packages/bosun/
COPY packages/logger/package.json packages/logger/

# --ignore-scripts skips the lefthook prepare hook (needs git, absent here).
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY apps/media-worker apps/media-worker
COPY packages packages

# Bundle to a single file. index.ts runs migrations on boot (re-exported from
# @repo/api/media), so drizzle-kit never needs to ship in the runtime image.
RUN bun build apps/media-worker/src/index.ts --target=bun --outfile dist/media-worker.js

# ── Stage 2: runtime image ────────────────────────────────────────────────────
# Only the bundle + SQL migrations + yt-dlp + ffmpeg. bun is the runtime;
# alpine keeps a shell for on-box debugging. yt-dlp requires python3 + pip.
FROM oven/bun:1-alpine AS runtime

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
# Migrations resolve relative to /app at runtime — same path as worker.
COPY --from=build /app/apps/api/src/db/migrations migrations

# No HTTP port: the media-worker only reaches out to Postgres + YouTube.
CMD ["bun", "media-worker.js"]
