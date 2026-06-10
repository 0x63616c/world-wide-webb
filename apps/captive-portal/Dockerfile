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
# workspace graph before copying source, keeps the layer cache effective.
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

# At RUNTIME the portal is self-contained (it talks to the api only over HTTP via
# the nginx proxy). But at BUILD time its tRPC client imports the AppRouter TYPE
# from @cc/api/trpc (www-q002.19), so tsc -b needs the api source + workspace
# packages present to resolve the type, same as apps/web's Dockerfile. These are
# type-only; nothing from api lands in the shipped static bundle.
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY packages ./packages
COPY apps/captive-portal ./apps/captive-portal

# Build the static bundle. `build` is `tsc -b && vite build`; output lands at
# apps/captive-portal/dist.
RUN bun run --cwd apps/captive-portal build


# Stage 2: nginx serves the static bundle, scope-proxies the portal api, and
# terminates TLS on :443 from the mounted portal-certs volume.
FROM nginx:1.27-alpine AS runtime

# openssl is needed by the entrypoint to mint a self-signed placeholder cert on a
# fresh volume (nginx:alpine does not ship it). Small, single layer.
RUN apk add --no-cache openssl

# Replace the default nginx config with ours: the server blocks (:80 + :443) and
# the shared scoped-proxy location include they both pull in.
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/captive-portal/nginx.conf /etc/nginx/conf.d/app.conf
COPY apps/captive-portal/_portal_locations.conf /etc/nginx/_portal_locations.conf

# Entrypoint: self-signed placeholder cert on a fresh volume + a cert-reload loop,
# then exec nginx (see the script header for why).
COPY apps/captive-portal/docker-entrypoint-portal.sh /docker-entrypoint-portal.sh

COPY --from=builder /app/apps/captive-portal/dist /usr/share/nginx/html

EXPOSE 80 443

# The entrypoint sets up certs + the reload loop, then exec's nginx as PID 1.
CMD ["/docker-entrypoint-portal.sh"]
