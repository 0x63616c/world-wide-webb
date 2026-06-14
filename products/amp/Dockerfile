FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY infra/package.json ./infra/package.json
COPY infra/cloudflare/package.json ./infra/cloudflare/package.json
COPY infra/unifi/package.json ./infra/unifi/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/platform/package.json ./packages/platform/package.json
COPY products/amp/package.json ./products/amp/package.json
COPY products/captive-portal/apps/api/package.json ./products/captive-portal/apps/api/package.json
COPY products/captive-portal/apps/frontend/package.json ./products/captive-portal/apps/frontend/package.json
COPY products/captive-portal/package.json ./products/captive-portal/package.json
COPY products/control-center/api/package.json ./products/control-center/api/package.json
COPY products/control-center/drizzle/package.json ./products/control-center/drizzle/package.json
COPY products/control-center/ios/package.json ./products/control-center/ios/package.json
COPY products/control-center/map-provision/package.json ./products/control-center/map-provision/package.json
COPY products/control-center/media-worker/package.json ./products/control-center/media-worker/package.json
COPY products/control-center/package.json ./products/control-center/package.json
COPY products/control-center/storybook/package.json ./products/control-center/storybook/package.json
COPY products/control-center/web/package.json ./products/control-center/web/package.json
COPY products/control-center/worker/package.json ./products/control-center/worker/package.json
COPY products/text-your-ex/package.json ./products/text-your-ex/package.json

RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./tsconfig.json
COPY products/amp ./products/amp

RUN bun run --cwd products/amp build

FROM nginx:1.27-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf
COPY products/amp/nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=builder /app/products/amp/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
