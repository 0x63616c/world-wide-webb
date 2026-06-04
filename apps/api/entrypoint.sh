#!/bin/sh
# Run drizzle migrations then exec the server.
# exec replaces this shell so bun is PID 1 and receives signals correctly.
# Swarm's crash-backoff handles ordering relative to postgres.
set -e

bun run --cwd /app/apps/api db:migrate

exec bun /app/apps/api/src/server.ts
