# Mac Mini homelab is the dev+prod host; whitelist it so local_resource/local() run.
allow_k8s_contexts('admin@homelab')

load('ext://uibutton', 'cmd_button', 'location')

update_settings(max_parallel_updates=4)

repo_root = str(local("git rev-parse --show-toplevel", quiet=True)).strip()

port_web = 4200
port_api = 4201
port_postgres = 5432

os.putenv("POSTGRES_PORT", str(port_postgres))

docker_compose(repo_root + "/docker-compose.yml")

# Shared platform infra (not a product): the dev Postgres every product's local
# stack talks to. Second label `shared` is its product lane for the
# product-lane check + Tilt UI grouping (www-jtp0.4.7).
dc_resource("postgres", labels=["backend", "shared"])

# One-shot batch fetch of all dev secrets from SOPS. The helper owns its repo-root
# resolution so this Tiltfile works from both the product folder and root scripts.
secrets_raw = str(local(repo_root + "/tilt/load-secrets.sh", quiet=True, echo_off=True))
secrets = {}
for line in secrets_raw.strip().split("\n"):
    if "=" in line:
        k, v = line.split("=", 1)
        secrets[k] = v

local_resource(
    "install",
    cmd="cd %s && bun install" % repo_root,
    deps=[repo_root + "/package.json", repo_root + "/bun.lock", repo_root + "/apps/api/package.json", repo_root + "/apps/web/package.json", repo_root + "/packages/api/package.json"],
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
    cmd="cd %s && DATABASE_URL='postgresql://cc:cc@localhost:%d/controlcenter' bun run --cwd apps/api db:migrate" % (repo_root, port_postgres),
    deps=[repo_root + "/apps/api/src/db/migrations"],
    resource_deps=["postgres", "install"],
    labels=["backend", "control-center"],
)

# api: bun --watch owns the file watch. Tilt orchestrates startup, bun handles reloads.
# Wrapped in the watchdog so a sustained-unhealthy /up (alive but not serving)
# exits non-zero and Tilt restarts it , no manual UI click on the wall panel.
local_resource(
    "api",
    serve_cmd="cd %s && scripts/serve-with-watchdog.sh http://localhost:%d/up 20 15 -- bun --watch apps/api/src/server.ts" % (repo_root, port_api),
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
# (worker, www-xjba), so dev must run it too or those loops never fire locally.
# Same env as the api (DB + HA token + home location); bun --watch owns the file
# watch. No readiness probe / watchdog: the worker serves no HTTP, so there is no
# URL to poll , bun --watch restarts it on a crash, and Tilt surfaces its logs.
local_resource(
    "worker",
    serve_cmd="cd %s && bun --watch apps/worker/src/index.ts" % repo_root,
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
    serve_cmd="cd %s && scripts/serve-with-watchdog.sh http://localhost:%d/ 30 15 -- bun run --cwd apps/web dev --port %d" % (repo_root, port_web, port_web),
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
    serve_cmd="cd %s && bun run --cwd apps/web storybook" % repo_root,
    resource_deps=["install"],
    labels=["frontend", "control-center"],
    links=[
        link("http://localhost:6006", "Storybook"),
    ],
)

# Drizzle Studio , manual, opt-in.
local_resource(
    "drizzle-studio",
    serve_cmd="cd %s && bun run --cwd apps/api db:studio" % repo_root,
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
    argv=["sh", "-c", "cd %s && bun run --cwd apps/api db:migrate" % repo_root],
    text="Migrate DB",
    icon_name="upgrade",
    location=location.RESOURCE,
)

cmd_button(
    name="db-reset",
    resource="postgres",
    argv=[
        "sh", "-c",
        "cd %s && docker compose -f docker-compose.yml exec -T postgres psql -U cc -d controlcenter -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' && bun run --cwd apps/api db:migrate" % repo_root,
    ],
    text="Reset DB",
    icon_name="delete_forever",
    location=location.RESOURCE,
    requires_confirmation=True,
)

# Boot the iOS kiosk shell in the iPad Pro simulator with live-reload pointing at
# the local web dev server (port_web). Capacitor config lives in
# web, so run cap from there. iPad Pro 13-inch (M5) is the
# closest installed sim to the 1366x1024 wall panel.
cmd_button(
    name="ipad-simulator",
    resource="web",
    argv=[
        "sh", "-c",
        'cd %s/apps/web && bunx cap run ios --live-reload --host localhost --port %d --target-name "iPad Pro 13-inch (M5)"' % (repo_root, port_web),
    ],
    text="iPad Simulator",
    icon_name="tablet_mac",
    location=location.RESOURCE,
)
