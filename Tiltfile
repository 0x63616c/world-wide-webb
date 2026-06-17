# Mac Mini homelab is the dev+prod host; whitelist it so local_resource/local() run.
allow_k8s_contexts('admin@homelab')

load('ext://uibutton', 'cmd_button', 'location')

update_settings(max_parallel_updates=4)

port_web = 4200
port_api = 4201
port_postgres = 5432

os.putenv("POSTGRES_PORT", str(port_postgres))

docker_compose("docker-compose.yml")

# Shared platform infra (not a product): the dev Postgres every product's local
# stack talks to. Second label `shared` is its product lane for the
# product-lane check + Tilt UI grouping (www-jtp0.4.7).
dc_resource("postgres", labels=["backend", "shared"])

# One-shot batch fetch of all dev secrets via individual `op read` calls (shim-
# cached, no rate-limit risk). tilt/load-secrets.sh reads each ref and prints
# KEY=VALUE lines; tilt/op-secrets.tpl is kept as a human-readable ref index.
secrets_raw = str(local("tilt/load-secrets.sh", quiet=True, echo_off=True))
secrets = {}
for line in secrets_raw.strip().split("\n"):
    if "=" in line:
        k, v = line.split("=", 1)
        secrets[k] = v

local_resource(
    "install",
    cmd="bun install",
    deps=["package.json", "bun.lock", "products/control-center/api/package.json", "products/control-center/web/package.json", "packages/api/package.json"],
    allow_parallel=True,
    labels=["tooling", "shared"],
)

# db-migrate: one-shot, runs pending Drizzle migrations before the API boots.
# Gating `api` on this guarantees the schema is current on a fresh/reset DB ,
# otherwise the API starts against an unmigrated schema and the device-sync loop
# dies on its first heartbeat write. Re-runs on migration-file changes; no-ops
# when the DB is already up to date.
local_resource(
    "db-migrate",
    cmd="DATABASE_URL='postgresql://cc:cc@localhost:%d/controlcenter' bun run --cwd products/control-center/api db:migrate" % port_postgres,
    deps=["products/control-center/api/src/db/migrations"],
    resource_deps=["postgres", "install"],
    labels=["backend", "control-center"],
)

# api: bun --watch owns the file watch. Tilt orchestrates startup, bun handles reloads.
# Wrapped in the watchdog so a sustained-unhealthy /up (alive but not serving)
# exits non-zero and Tilt restarts it , no manual UI click on the wall panel.
local_resource(
    "api",
    serve_cmd="scripts/serve-with-watchdog.sh http://localhost:%d/up 20 15 -- bun --watch products/control-center/api/src/server.ts" % port_api,
    serve_env={
        "PORT": str(port_api),
        "DATABASE_URL": "postgresql://cc:cc@localhost:%d/controlcenter" % port_postgres,
        "HA_TOKEN": secrets["HA_TOKEN"],
        "UNIFI_API_KEY": secrets["UNIFI_API_KEY"],
        "WIFI_SSID": secrets["WIFI_SSID"],
        "WIFI_PASSWORD": secrets["WIFI_PASSWORD"],
        # Real home location from 1Password so local dev matches prod; env.ts
        # falls back to the public LA placeholder if these are absent (www-mqp).
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
    labels=["backend", "control-center"],
    links=[
        link("http://localhost:%d/up" % port_api, "API /up"),
    ],
)

# worker: the continuous reconcile/ingest loops (device-sync, weather-ingest)
# that used to run inside the api now live in a dedicated worker app + image
# (products/control-center/worker, www-xjba), so dev must run it too or those loops never fire locally.
# Same env as the api (DB + HA token + home location); bun --watch owns the file
# watch. No readiness probe / watchdog: the worker serves no HTTP, so there is no
# URL to poll , bun --watch restarts it on a crash, and Tilt surfaces its logs.
local_resource(
    "worker",
    serve_cmd="bun --watch products/control-center/worker/src/index.ts",
    serve_env={
        "DATABASE_URL": "postgresql://cc:cc@localhost:%d/controlcenter" % port_postgres,
        "HA_TOKEN": secrets["HA_TOKEN"],
        "UNIFI_API_KEY": secrets["UNIFI_API_KEY"],
        "WIFI_SSID": secrets["WIFI_SSID"],
        "WIFI_PASSWORD": secrets["WIFI_PASSWORD"],
        "HOME_LAT": secrets["HOME_LAT"],
        "HOME_LON": secrets["HOME_LON"],
        "HOME_PLACE_NAME": secrets["HOME_PLACE_NAME"],
        "HOME_RADIUS_MILES": secrets["HOME_RADIUS_MILES"],
    },
    resource_deps=["postgres", "install", "db-migrate"],
    labels=["backend", "control-center"],
)

# web: Vite owns HMR. No `deps=` , same reasoning as api.
# Watchdog-wrapped for the same self-heal reason as api (this is the one that
# usually fails to come up). Vite cold start is slower, so a longer grace.
local_resource(
    "web",
    serve_cmd="scripts/serve-with-watchdog.sh http://localhost:%d/ 30 15 -- bun run --cwd products/control-center/web dev --port %d" % (port_web, port_web),
    serve_env={
        "API_PORT": str(port_api),
    },
    readiness_probe=probe(
        http_get=http_get_action(port=port_web, path="/"),
        period_secs=1,
    ),
    resource_deps=["api", "install"],
    labels=["frontend", "control-center"],
    links=[
        link("http://localhost:%d" % port_web, "Web"),
    ],
)

# Storybook , auto-started with the dev stack so it's always available for tile work.
local_resource(
    "storybook",
    serve_cmd="bun run --cwd products/control-center/web storybook",
    resource_deps=["install"],
    labels=["frontend", "control-center"],
    links=[
        link("http://localhost:6006", "Storybook"),
    ],
)

# Drizzle Studio , manual, opt-in.
local_resource(
    "drizzle-studio",
    serve_cmd="bun run --cwd products/control-center/api db:studio",
    resource_deps=["postgres"],
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    labels=["tooling", "control-center"],
    links=[
        link("https://local.drizzle.studio", "Drizzle Studio"),
    ],
)

# Sidebar buttons.
cmd_button(
    name="db-migrate",
    resource="postgres",
    argv=["sh", "-c", "bun run --cwd products/control-center/api db:migrate"],
    text="Migrate DB",
    icon_name="upgrade",
    location=location.RESOURCE,
)

cmd_button(
    name="db-reset",
    resource="postgres",
    argv=[
        "sh", "-c",
        "docker compose exec -T postgres psql -U cc -d controlcenter -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && bun run --cwd products/control-center/api db:migrate",
    ],
    text="Reset DB",
    icon_name="delete_forever",
    location=location.RESOURCE,
    requires_confirmation=True,
)

# Boot the iOS kiosk shell in the iPad Pro simulator with live-reload pointing at
# the local web dev server (port_web). Capacitor config lives in
# products/control-center/web, so run cap from there. iPad Pro 13-inch (M5) is the
# closest installed sim to the 1366x1024 wall panel.
cmd_button(
    name="ipad-simulator",
    resource="web",
    argv=[
        "sh", "-c",
        'cd products/control-center/web && bunx cap run ios --live-reload --host localhost --port %d --target-name "iPad Pro 13-inch (M5)"' % port_web,
    ],
    text="iPad Simulator",
    icon_name="tablet_mac",
    location=location.RESOURCE,
)
