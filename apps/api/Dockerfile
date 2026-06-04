# Multi-stage build for the API (bun/tRPC server).
# Stage 1 installs deps; stage 2 is the slim runtime image.
# Entrypoint runs drizzle migrations before starting the server so ordering
# is handled by Swarm's crash-backoff — no depends_on needed.

FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Copy workspace manifests first; bun resolves workspace packages from these.
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/bosun/package.json ./packages/bosun/package.json

RUN bun install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages/bosun/src ./packages/bosun/src


# Runtime: same bun base (alpine keeps the image small).
FROM oven/bun:1.2-alpine AS runtime

WORKDIR /app

# Copy installed node_modules and source from builder.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages
COPY package.json ./

EXPOSE 4201

# entrypoint.sh: run migrations then exec the server so bun is PID 1.
COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
