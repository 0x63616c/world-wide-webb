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

# docker CLI — runs `docker stack deploy` / `docker secret` against the host
# daemon via the socket bind-mounted by the bosun-agent service. op CLI —
# resolves op:// secret refs during the agent's own `bosun up`. Both copied from
# official multi-arch images so the build works on amd64 and arm64 alike.
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=1password/op:2 /usr/local/bin/op /usr/local/bin/op

# Source bosun executes, the config it loads, and the infra files the stack
# render references. package.json/bun.lock are copied for module resolution only.
COPY package.json bun.lock ./
COPY deploy.config.ts ./
COPY packages/bosun ./packages/bosun
COPY infra ./infra

COPY packages/bosun/docker-entrypoint.sh /usr/local/bin/bosun-entrypoint
RUN chmod +x /usr/local/bin/bosun-entrypoint

EXPOSE 4202

ENTRYPOINT ["/usr/local/bin/bosun-entrypoint"]
