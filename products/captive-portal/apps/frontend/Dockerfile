# Multi-stage build for the captive portal (React/Vite static bundle).
# Stage 1 builds the bundle with bun; stage 2 serves it via nginx.
#
# SECURITY BOUNDARY: guests on the open guest WLAN are untrusted. This nginx
# proxies ONLY /api/trpc/portal.* to the dashboard api (api:4201) and 404s every
# other /api path, so a guest can never reach a dashboard procedure
# (lights/climate/Sonos). See products/captive-portal/apps/frontend/nginx.conf + docs/captive-portal.

FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Install workspace deps. Copy root manifests first so bun resolves the
# workspace graph before copying source, keeps the layer cache effective.
COPY package.json bun.lock ./
COPY products/captive-portal/package.json ./products/captive-portal/package.json
COPY products/captive-portal/apps/api/package.json ./products/captive-portal/apps/api/package.json
COPY products/captive-portal/apps/frontend/package.json ./products/captive-portal/apps/frontend/package.json
COPY products/control-center/package.json ./products/control-center/package.json
COPY products/control-center/api/package.json ./products/control-center/api/package.json
COPY products/control-center/drizzle/package.json ./products/control-center/drizzle/package.json
COPY products/control-center/ios/package.json ./products/control-center/ios/package.json
COPY products/control-center/map-provision/package.json ./products/control-center/map-provision/package.json
COPY products/control-center/media-worker/package.json ./products/control-center/media-worker/package.json
COPY products/control-center/storybook/package.json ./products/control-center/storybook/package.json
COPY products/control-center/web/package.json ./products/control-center/web/package.json
COPY products/control-center/worker/package.json ./products/control-center/worker/package.json
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

# Root tsconfig must be present so the app tsconfig can extend ../../../../tsconfig.json.
COPY tsconfig.json ./tsconfig.json

# At RUNTIME the portal is self-contained (it talks to the api only over HTTP via
# the nginx proxy). But at BUILD time its tRPC client imports the AppRouter TYPE
# from @cc/captive-portal-api, so tsc -b needs the api source + workspace
# packages present to resolve the type. These are
# type-only; nothing from api lands in the shipped static bundle.
COPY products/control-center/api/src ./products/control-center/api/src
COPY products/control-center/api/tsconfig.json ./products/control-center/api/tsconfig.json
COPY packages ./packages
COPY products/captive-portal/apps/api/src ./products/captive-portal/apps/api/src
COPY products/captive-portal/apps/api/tsconfig.json ./products/captive-portal/apps/api/tsconfig.json
COPY products/captive-portal/apps/frontend ./products/captive-portal/apps/frontend

# Build the static bundle. `build` is `tsc -b && vite build`; output lands at
# products/captive-portal/apps/frontend/dist.
RUN bun run --cwd products/captive-portal/apps/frontend build


# Stage 2: nginx serves the static bundle, scope-proxies the portal api, and
# terminates TLS on :443 from the mounted portal-certs volume.
FROM nginx:1.27-alpine AS runtime

# openssl is needed by the entrypoint to mint a self-signed placeholder cert on a
# fresh volume (nginx:alpine does not ship it). Small, single layer.
RUN apk add --no-cache openssl

# Replace the default nginx config with ours: the server blocks (:80 + :443) and
# the shared scoped-proxy location include they both pull in.
RUN rm /etc/nginx/conf.d/default.conf
COPY products/captive-portal/apps/frontend/nginx.conf /etc/nginx/conf.d/app.conf
COPY products/captive-portal/apps/frontend/_portal_locations.conf /etc/nginx/_portal_locations.conf

# Entrypoint: self-signed placeholder cert on a fresh volume + a cert-reload loop,
# then exec nginx (see the script header for why).
COPY products/captive-portal/apps/frontend/docker-entrypoint-portal.sh /docker-entrypoint-portal.sh

COPY --from=builder /app/products/captive-portal/apps/frontend/dist /usr/share/nginx/html

EXPOSE 80 443

# The entrypoint sets up certs + the reload loop, then exec's nginx as PID 1.
CMD ["/docker-entrypoint-portal.sh"]
