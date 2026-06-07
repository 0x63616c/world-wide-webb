# Thin wrapper around the upstream Drizzle Gateway (self-hosted Drizzle Studio),
# so we can browse the prod control_center Postgres at drizzle.worldwidewebb.co.
#
# The upstream image is distroless (a bun runtime, no shell) and reads MASTERPASS
# from the ENVIRONMENT, but bosun delivers every secret as a FILE under
# /run/secrets — there is no op->env rail (see packages/bosun/docker-entrypoint.sh
# for the same file->env bridge on the agent). With no shell the gateway can't cat
# the file itself, so we bun --preload a tiny module that loads
# /run/secrets/MASTERPASS into process.env before the gateway boots.
#
# Pinned to the tag already proven on the homelab box in the evee deploy. The
# base sets WorkingDir /entry and ENTRYPOINT ["bun","run","index.js"]; we keep the
# same cwd and entry, only inserting the preload.
FROM ghcr.io/drizzle-team/gateway:1.2.0

COPY apps/drizzle/load-secret.js /entry/load-secret.js

ENTRYPOINT ["bun", "--preload", "/entry/load-secret.js", "index.js"]
