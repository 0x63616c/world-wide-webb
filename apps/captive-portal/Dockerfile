# Multi-stage build for the captive portal (React/Vite static bundle).
# Stage 1 builds the bundle with bun; stage 2 serves it via nginx.
#
# SECURITY BOUNDARY: guests on the open guest WLAN are untrusted. This nginx
# proxies ONLY /api/trpc/portal.* to the dashboard api (api:4201) and 404s every
# other /api path, so a guest can never reach a dashboard procedure
# (lights/climate/Sonos). See apps/captive-portal/nginx.conf + docs/captive-portal.

FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Install workspace deps. Copy root manifests first so bun resolves the
# workspace graph before copying source — keeps the layer cache effective.
COPY package.json bun.lock ./
COPY apps/captive-portal/package.json ./apps/captive-portal/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/media-worker/package.json ./apps/media-worker/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/bosun/package.json ./packages/bosun/package.json
COPY packages/logger/package.json ./packages/logger/package.json

# --ignore-scripts skips the lefthook prepare hook (needs git, not in alpine image).
RUN bun install --frozen-lockfile --ignore-scripts

# Root tsconfig must be present so the app tsconfig can extend ../../tsconfig.json.
COPY tsconfig.json ./tsconfig.json

# Copy the app source. The portal is self-contained (no @repo/api runtime import;
# it talks to the api only over HTTP via the nginx proxy), so only its own tree
# plus the root tsconfig are needed to build the static bundle.
COPY apps/captive-portal ./apps/captive-portal

# Build the static bundle. `build` is `tsc -b && vite build`; output lands at
# apps/captive-portal/dist.
RUN bun run --cwd apps/captive-portal build


# Stage 2: nginx serves the static bundle and scope-proxies the portal api.
FROM nginx:1.27-alpine AS runtime

# Replace the default nginx config with ours (the scoped portal proxy).
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/captive-portal/nginx.conf /etc/nginx/conf.d/app.conf

COPY --from=builder /app/apps/captive-portal/dist /usr/share/nginx/html

EXPOSE 80

# nginx runs as PID 1; no shell wrapper needed.
CMD ["nginx", "-g", "daemon off;"]
