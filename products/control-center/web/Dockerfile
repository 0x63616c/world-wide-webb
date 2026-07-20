# Multi-stage build for the web app (React/Vite static bundle).
# Stage 1 builds the bundle with bun; stage 2 serves it via nginx.
# nginx also reverse-proxies /trpc → api:4201 so there is no CORS surface.

FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Install all workspace deps. Copy root manifests first so bun can resolve
# workspace packages before copying source, keeps the layer cache effective.
COPY package.json bun.lock ./
COPY products/control-center/package.json ./products/control-center/package.json
COPY products/control-center/web/package.json ./products/control-center/web/package.json
COPY products/control-center/api/package.json ./products/control-center/api/package.json
COPY products/control-center/worker/package.json ./products/control-center/worker/package.json
COPY products/control-center/media-worker/package.json ./products/control-center/media-worker/package.json
COPY products/control-center/drizzle/package.json ./products/control-center/drizzle/package.json
COPY products/control-center/map-provision/package.json ./products/control-center/map-provision/package.json
COPY products/control-center/ios/package.json ./products/control-center/ios/package.json
COPY products/control-center/storybook/package.json ./products/control-center/storybook/package.json
COPY products/captive-portal/package.json ./products/captive-portal/package.json
COPY products/captive-portal/apps/api/package.json ./products/captive-portal/apps/api/package.json
COPY products/captive-portal/apps/frontend/package.json ./products/captive-portal/apps/frontend/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/platform/package.json ./packages/platform/package.json
COPY packages/worker-runtime/package.json ./packages/worker-runtime/package.json
# Infra Pulumi workspaces (www-j934.1/.2/.3): root package.json declares these, so
# bun install needs their manifests in the build context (www-272b).
COPY infra/package.json ./infra/package.json
COPY infra/cloudflare/package.json ./infra/cloudflare/package.json
COPY infra/unifi/package.json ./infra/unifi/package.json

# --ignore-scripts skips the lefthook prepare hook (needs git, not in alpine image).
RUN bun install --frozen-lockfile --ignore-scripts

# Root tsconfig must be present so workspace tsconfigs can extend it.
COPY tsconfig.json ./tsconfig.json

# Copy workspace source. packages/api provides the @cc/api type export.
COPY products/control-center/api/src ./products/control-center/api/src
COPY products/control-center/api/tsconfig.json ./products/control-center/api/tsconfig.json
COPY products/control-center/web ./products/control-center/web
COPY packages ./packages

# Commit SHA baked into the bundle (vite `define`) so the running panel reports
# its build. CI passes --build-arg BUILD_HASH=${github.sha}; absent (local docker
# build) it falls back to "dev" since the builder image has no .git.
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH

# Commit timestamp (unix-ms) baked alongside the SHA so the bottom-left badge can
# render "time since commit". CI passes --build-arg BUILD_TIME=<commit ms>; absent
# (local docker build) vite emits "NaN" since the builder image has no .git, and
# the badge omits the age. Without this the age never appears in a prod build.
ARG BUILD_TIME
ENV BUILD_TIME=$BUILD_TIME

# Build the static bundle. Output lands at products/control-center/web/dist.
RUN bun run --cwd products/control-center/web build


# Stage 2: nginx serves the static bundle and proxies /trpc to the api.
FROM nginx:1.27-alpine AS runtime

# Remove the default nginx config and replace it with ours.
RUN rm /etc/nginx/conf.d/default.conf

COPY products/control-center/web/nginx.conf /etc/nginx/conf.d/app.conf

COPY --from=builder /app/products/control-center/web/dist /usr/share/nginx/html

EXPOSE 80

# nginx runs as PID 1; no shell wrapper needed.
CMD ["nginx", "-g", "daemon off;"]
