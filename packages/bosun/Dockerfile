# syntax=docker/dockerfile:1

# bosun-agent runtime image: the CI deploy webhook receiver.
#
# Unlike apps/api this is NOT bundled — `bosun serve`/`bosun up` import
# deploy.config.ts at runtime (process.cwd()) and shell out to `docker` and
# `op`, so the image ships the source tree + both CLIs. bosun has no runtime npm
# deps (only relative .ts files + node builtins, executed directly by bun), so
# there is no install step.
FROM oven/bun:1-alpine AS runtime

WORKDIR /app

# Tools the agent's own `bosun up` verify shells out to, plus the timezone DB the
# scheduler needs:
#   - curl + jq      cmdProbes ("live HA data" curls api and pipes through jq);
#                    without them the probes exit 127 and verify is structurally red.
#   - postgresql-client  provides pg_isready for the "postgres ready" cmdProbe.
#   - tzdata         zoneinfo so TZ=America/Los_Angeles resolves; alpine ships no
#                    timezone database by default, so without it the scheduler's
#                    wall-clock would stay UTC even with TZ set (CC-dd0).
RUN apk add --no-cache curl jq postgresql-client tzdata

# The agent's wall clock is LA local. The bosun scheduler matches cronJob()
# schedules against the container clock (Date.getHours() honours TZ), so
# `docker-image-prune 0 3 * * *` fires at 03:00 LA off-peak, not 03:00 UTC
# (~8pm LA on-peak). IANA zone => DST handled automatically. See CC-dd0.
ENV TZ=America/Los_Angeles

# docker CLI — runs `docker stack deploy` / `docker secret` against the host
# daemon via the socket bind-mounted by the bosun-agent service. op CLI —
# resolves op:// secret refs during the agent's own `bosun up`. Both copied from
# official multi-arch images so the build works on amd64 and arm64 alike.
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=1password/op:2 /usr/local/bin/op /usr/local/bin/op

# Source bosun executes and the config it loads. package.json/bun.lock are
# copied for module resolution only. (infra/ is intentionally not copied — the
# renderer doesn't emit configs/volumes yet; see CC-oos.)
COPY package.json bun.lock ./
COPY deploy.config.ts ./
COPY packages/bosun ./packages/bosun

COPY packages/bosun/docker-entrypoint.sh /usr/local/bin/bosun-entrypoint
RUN chmod +x /usr/local/bin/bosun-entrypoint

EXPOSE 4202

ENTRYPOINT ["/usr/local/bin/bosun-entrypoint"]
