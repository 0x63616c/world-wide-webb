# Text Your Ex - single-image build. Builds the web app, serves it + the API from Bun.
FROM oven/bun:1.2.19 AS build
WORKDIR /app

# install deps (web + server + root)
COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY server/package.json server/package.json
COPY e2e/package.json e2e/package.json
RUN bun install --frozen-lockfile

# build the web app
COPY . .
RUN bun run --cwd web build

# ── runtime image ──
FROM oven/bun:1.2.19 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
# bring over installed deps + built artifacts + server source
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

# persistent sqlite lives here
ENV TYE_DB=/app/data/tye.sqlite
VOLUME ["/app/data"]

EXPOSE 8787
CMD ["bun", "run", "server/src/index.ts"]
