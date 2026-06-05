# Mac Mini homelab is the dev+prod host; whitelist it so local_resource/local() run.
allow_k8s_contexts('admin@homelab')

load('ext://uibutton', 'cmd_button', 'location')

update_settings(max_parallel_updates=4)

port_web = 4200
port_api = 4201
port_postgres = 5432

os.putenv("POSTGRES_PORT", str(port_postgres))

docker_compose("docker-compose.yml")

dc_resource("postgres", labels=["backend"])

# One-shot batch fetch of all dev secrets via `op inject`. The template at
# tilt/op-secrets.tpl contains only 1Password refs (no secret material) and is
# safe to commit.
secrets_raw = str(local("op inject -i tilt/op-secrets.tpl", quiet=True, echo_off=True))
secrets = {}
for line in secrets_raw.strip().split("\n"):
    if "=" in line:
        k, v = line.split("=", 1)
        secrets[k] = v

local_resource(
    "install",
    cmd="bun install",
    deps=["package.json", "bun.lock", "apps/api/package.json", "apps/web/package.json", "packages/api/package.json"],
    allow_parallel=True,
    labels=["tooling"],
)

# db-migrate: one-shot, runs pending Drizzle migrations before the API boots.
# Gating `api` on this guarantees the schema is current on a fresh/reset DB —
# otherwise the API starts against an unmigrated schema and the device-sync loop
# dies on its first heartbeat write. Re-runs on migration-file changes; no-ops
# when the DB is already up to date.
local_resource(
    "db-migrate",
    cmd="DATABASE_URL='postgresql://cc:cc@localhost:%d/controlcenter' bun run --cwd apps/api db:migrate" % port_postgres,
    deps=["apps/api/src/db/migrations"],
    resource_deps=["postgres", "install"],
    labels=["backend"],
)

# api: bun --watch owns the file watch. Tilt orchestrates startup, bun handles reloads.
# Wrapped in the watchdog so a sustained-unhealthy /up (alive but not serving)
# exits non-zero and Tilt restarts it — no manual UI click on the wall panel.
local_resource(
    "api",
    serve_cmd="scripts/serve-with-watchdog.sh http://localhost:%d/up 20 15 -- bun --watch apps/api/src/server.ts" % port_api,
    serve_env={
        "PORT": str(port_api),
        "DATABASE_URL": "postgresql://cc:cc@localhost:%d/controlcenter" % port_postgres,
        "HA_TOKEN": secrets["HA_TOKEN"],
        "UNIFI_API_KEY": secrets["UNIFI_API_KEY"],
        "WIFI_SSID": secrets["WIFI_SSID"],
        "WIFI_PASSWORD": secrets["WIFI_PASSWORD"],
        # Real home location from 1Password so local dev matches prod; env.ts
        # falls back to the public LA placeholder if these are absent (CC-mqp).
        "HOME_LAT": secrets["HOME_LAT"],
        "HOME_LON": secrets["HOME_LON"],
        "HOME_PLACE_NAME": secrets["HOME_PLACE_NAME"],
        "HOME_RADIUS_MILES": secrets["HOME_RADIUS_MILES"],
    },
    readiness_probe=probe(
        http_get=http_get_action(port=port_api, path="/up"),
        period_secs=1,
    ),
    resource_deps=["postgres", "install", "db-migrate"],
    labels=["backend"],
    links=[
        link("http://localhost:%d/up" % port_api, "API /up"),
    ],
)

# web: Vite owns HMR. No `deps=` — same reasoning as api.
# Watchdog-wrapped for the same self-heal reason as api (this is the one that
# usually fails to come up). Vite cold start is slower, so a longer grace.
local_resource(
    "web",
    serve_cmd="scripts/serve-with-watchdog.sh http://localhost:%d/ 30 15 -- bun run --cwd apps/web dev --port %d" % (port_web, port_web),
    serve_env={
        "API_PORT": str(port_api),
    },
    readiness_probe=probe(
        http_get=http_get_action(port=port_web, path="/"),
        period_secs=1,
    ),
    resource_deps=["api", "install"],
    labels=["frontend"],
    links=[
        link("http://localhost:%d" % port_web, "Web"),
    ],
)

# Storybook — auto-started with the dev stack so it's always available for tile work.
local_resource(
    "storybook",
    serve_cmd="bun run --cwd apps/web storybook",
    resource_deps=["install"],
    labels=["frontend"],
    links=[
        link("http://localhost:6006", "Storybook"),
    ],
)

# Drizzle Studio — manual, opt-in.
local_resource(
    "drizzle-studio",
    serve_cmd="bun run --cwd apps/api db:studio",
    resource_deps=["postgres"],
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=["tooling"],
    links=[
        link("https://local.drizzle.studio", "Drizzle Studio"),
    ],
)

# Sidebar buttons.
cmd_button(
    name="db-migrate",
    resource="postgres",
    argv=["sh", "-c", "bun run --cwd apps/api db:migrate"],
    text="Migrate DB",
    icon_name="upgrade",
    location=location.RESOURCE,
)

cmd_button(
    name="db-reset",
    resource="postgres",
    argv=[
        "sh", "-c",
        "docker compose exec -T postgres psql -U cc -d controlcenter -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && bun run --cwd apps/api db:migrate",
    ],
    text="Reset DB",
    icon_name="delete_forever",
    location=location.RESOURCE,
    requires_confirmation=True,
)
