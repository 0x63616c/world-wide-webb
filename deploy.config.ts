// Control-center deployment manifest. Pure data — no I/O, no side effects.
// Secret refs point at 1Password items; values are resolved at sync time only.
// See docs/deployment-design.md Part 6 for the full spec.
//
// Images declare the mutable :main tag here (via ghcr()); at deploy time the CI
// webhook supplies the exact per-image digest and renderStackYml pins each to
// ...@sha256:<digest>, so a stack deploy rolls only the rebuilt services (CC-czg).

import {
  certProbe,
  cmdProbe,
  cronJob,
  fromOp,
  ghcr,
  healthcheck,
  httpProbe,
  postgres,
  service,
  stack,
} from "./packages/bosun/src/spec.ts";

export default stack("control-center", {
  services: [
    // API: tRPC backend, internal only, proxied through web at /api.
    service("api", {
      image: ghcr("control-center-api"),
      // Hard 512M cap; cpu reservation puts the request path on the critical path
      // so it always schedules under contention (CC-ke9a).
      resources: { memory: "512M", reserveCpus: "0.5" },
      secrets: fromOp("Homelab", {
        HA_TOKEN: "Home Assistant Token/credential",
        UNIFI_API_KEY: "UniFi/local_api_key",
        WIFI_SSID: "WiFi Guest Credentials/ssid",
        WIFI_PASSWORD: "WiFi Guest Credentials/password",
        POSTGRES_PASSWORD: "Control Center Postgres/password",
        // Home location is private (not a credential, but it is a home address)
        // so it rides the op→docker-secret rail instead of being baked into the
        // open-source repo. env.ts ships a public LA placeholder default; these
        // deliver the real values. See scripts/save-home-location.sh (CC-mqp).
        HOME_LAT: "Home Location/lat",
        HOME_LON: "Home Location/lon",
        HOME_PLACE_NAME: "Home Location/place_name",
        HOME_RADIUS_MILES: "Home Location/radius_miles",
        // Spotify Web API credentials for the media router (CC-51hf.35).
        SPOTIFY_CLIENT_ID: "Spotify/client_id",
        SPOTIFY_CLIENT_SECRET: "Spotify/client_secret",
        SPOTIFY_REFRESH_TOKEN: "Spotify/refresh_token",
        // Resend email API for the captive-portal verification code (CC-q002.11).
        // Only the api sends portal email; the worker does not get these.
        RESEND_API_KEY: "Resend/credential",
        RESEND_FROM: "Resend/from-address",
      }),
      env: {
        NODE_ENV: "production",
        // APP_ENV is the logger's env LABEL, read live at runtime. NODE_ENV is
        // baked into the bun single-file bundle at build time so it can't carry
        // the runtime env into logs; APP_ENV can. CC-rw07.
        APP_ENV: "production",
        // Fixed-location LA wall panel: run the API in Pacific time so the
        // weather ingest parses Open-Meteo's timezone=auto LA-local timestamps
        // correctly and read-time hour labels match the board's local clock.
        // Without this the container defaults to UTC and weather is shifted 7h.
        TZ: "America/Los_Angeles",
        // Home Assistant is on the host via OrbStack's host alias.
        HA_URL: "http://host.docker.internal:8123",
        // The UniFi gateway is a separate LAN device, NOT the docker host, so
        // this points at the gateway IP (unlike HA, which runs on the host).
        // CC-355t.7 fixed the env KEY name but left the value as
        // host.docker.internal (dead on :443) -> network.status timed out and
        // the tile hung; the gateway IP is what env.ts already defaulted to and
        // what actually worked before (CC-9m05).
        UNIFI_CONTROLLER_URL: "https://192.168.0.1",
        // DATABASE_URL is built at runtime from the mounted POSTGRES_PASSWORD
        // docker secret (apps/api/src/env.ts) so the password never lands in
        // the service spec. postgres host/db/user use the env.ts defaults.
      },
      port: 4201,
      // Swarm-tracked liveness from inside the container: the bun-alpine runtime
      // ships wget (no curl); /up is the api's own readiness endpoint. start_period
      // covers boot + drizzle migrate-on-boot before failures count.
      healthcheck: healthcheck("wget -q -O /dev/null http://localhost:4201/up || exit 1", {
        startPeriod: "40s",
      }),
      health: [
        httpProbe("http://api:4201/up", 200),
        // Hits the api's dedicated REST health route (CC-hya3), not a tRPC proc,
        // so the probe can't silently rot when a procedure is renamed. The route
        // returns live HA ambient temp and throws (->500) on an HA outage.
        cmdProbe("live HA data", "curl -sf http://api:4201/health/climate | jq -e .ambient"),
      ],
    }),

    // Worker: the continuous reconcile/ingest loops (light/climate enforcers,
    // device-sync fan, party engine, weather ingest), split off the api so the api
    // stays request-only (CC-7d5b.1.2 → CC-xjba). Now its OWN app + image
    // (apps/worker → control-center-worker), not a command override on the api
    // image: CI has a dedicated build-worker job + path filter, the deploy webhook
    // reports the control-center-worker digest, and bosun's pinImage rolls it
    // independently of the api. No route, no port: it serves no traffic, it only
    // reaches out to HA + Postgres over the overlay network. Secrets/env mirror
    // the api so the two stay in lockstep (the worker reads the DB password, HA
    // token, and runs in Pacific time like the api). The image CMD is `bun
    // worker.js` (apps/worker/Dockerfile), so no command override is needed.
    service("worker", {
      image: ghcr("control-center-worker"),
      // 384M cap for the reconcile/ingest loops (CC-ke9a).
      resources: { memory: "384M" },
      secrets: fromOp("Homelab", {
        HA_TOKEN: "Home Assistant Token/credential",
        UNIFI_API_KEY: "UniFi/local_api_key",
        WIFI_SSID: "WiFi Guest Credentials/ssid",
        WIFI_PASSWORD: "WiFi Guest Credentials/password",
        POSTGRES_PASSWORD: "Control Center Postgres/password",
        HOME_LAT: "Home Location/lat",
        HOME_LON: "Home Location/lon",
        HOME_PLACE_NAME: "Home Location/place_name",
        HOME_RADIUS_MILES: "Home Location/radius_miles",
        // Spotify credentials mirrored from the api to keep the two services
        // in lockstep (deploy-config.test.ts asserts they match — CC-51hf.35).
        SPOTIFY_CLIENT_ID: "Spotify/client_id",
        SPOTIFY_CLIENT_SECRET: "Spotify/client_secret",
        SPOTIFY_REFRESH_TOKEN: "Spotify/refresh_token",
      }),
      env: {
        NODE_ENV: "production",
        // APP_ENV is the logger's env LABEL, read live at runtime. NODE_ENV is
        // baked into the bun single-file bundle at build time so it can't carry
        // the runtime env into logs; APP_ENV can. CC-rw07.
        APP_ENV: "production",
        // Pacific time so weather-ingest parses Open-Meteo's timezone=auto
        // LA-local timestamps correctly (matches the api, see its note).
        TZ: "America/Los_Angeles",
        HA_URL: "http://host.docker.internal:8123",
        // Gateway IP, not the docker host — see the api note above (CC-9m05).
        UNIFI_CONTROLLER_URL: "https://192.168.0.1",
      },
    }),

    // Media-worker: downloads YouTube playlists/sets to the NAS and records them
    // in Postgres (generic job queue + youtube_ingest handler + playlist poller).
    // Its own image so a long yt-dlp download never shares a container with the
    // 1s reconcile loops in `worker` (CC-kp4k). Storage is the Synology NAS,
    // bind-mounted from the host's persistent NFS mount (/Users/calum/control-center/media,
    // mounted by the homelab LaunchDaemon) — OrbStack containers have no LAN route,
    // so the HOST does the NFS and the container just sees a folder, same pattern
    // as the web service's `maps` mount. Pinned to the manager (host-local mount).
    service("media-worker", {
      image: ghcr("control-center-media-worker"),
      // RE-PARKED AT 0 — second hold (CC-6mz7). The 1G cap (below) solved the
      // ORIGINAL outage cause (uncapped OOM → RCU stall), but re-enabling exposed a
      // SECOND, separate blocker: the container can't even start because OrbStack's
      // bind-mount of the NFS media share (/Users/calum/control-center/media) HANGS
      // (a throwaway `docker run -v …` hangs >20s; host `ls` is instant). The stuck
      // uninterruptible mount ops then wedged dockerd's task-create path and took
      // the cloudflared connector down too → a fresh Cloudflare 1033 outage. So
      // media-worker stays at 0 until the OrbStack↔NFS share is fixed (CC-6mz7:
      // re-establish the share / mount NFS before OrbStack init). The cap stays set
      // so re-enabling is again a one-line 0→1 flip once CC-6mz7 lands.
      replicas: 0,
      // 1G hard memory cap — the structural fix for the outage (CC-ke9a). yt-dlp
      // streams to disk and never re-encodes, so peak working set is hundreds of
      // MB independent of file size; under cgroup v2 this cap also contains the
      // dirty page-cache writeback to the slow NAS NFS mount that ballooned RAM
      // and RCU-stalled the VM.
      resources: { memory: "1G" },
      secrets: fromOp("Homelab", {
        POSTGRES_PASSWORD: "Control Center Postgres/password",
        OPENROUTER_API_KEY: "OpenRouter/credential",
      }),
      env: {
        NODE_ENV: "production",
        // APP_ENV is the logger's env LABEL, read live at runtime. NODE_ENV is
        // baked into the bun single-file bundle at build time so it can't carry
        // the runtime env into logs; APP_ENV can. CC-rw07.
        APP_ENV: "production",
        TZ: "America/Los_Angeles",
        MEDIA_STORAGE_DIR: "/app/media",
      },
      volumes: ["/Users/calum/control-center/media:/app/media"],
      placement: ["node.role==manager"],
    }),

    // Web: static build + /api reverse-proxy, public via Cloudflare tunnel.
    // The Tesla-map basemap (/maps/*.pmtiles) is too large to bake into the image
    // (100s of MB), so it is served off a host bind mount populated by the
    // `map-extract` job below (CC-gma). nginx serves it with byte-range support,
    // which is exactly what the pmtiles client needs. The mount is host-node-local,
    // so the service is pinned to the manager (the single Swarm node holding it).
    service("web", {
      image: ghcr("control-center-web"),
      // 96M cap — nginx serving static assets + a range-request basemap (CC-ke9a).
      resources: { memory: "96M" },
      route: "dashboard.worldwidewebb.co",
      proxyApiTo: "api:4201",
      port: 80,
      volumes: ["/Users/calum/control-center/maps:/usr/share/nginx/html/maps:ro"],
      placement: ["node.role==manager"],
      // Swarm-tracked liveness: nginx:alpine ships curl; hit the local root so the
      // check stays inside the container (not out through Cloudflare like the
      // verify probe below).
      healthcheck: healthcheck("curl -fsS http://localhost:80/ -o /dev/null || exit 1"),
      health: [
        httpProbe("https://dashboard.worldwidewebb.co", 200),
        // Cert-expiry lookahead: go red ~14 days BEFORE the dashboard's TLS cert
        // expires, while there is still time to renew. A plain http probe only
        // fails once the cert is already invalid, which is too late. (The earlier
        // `httpProbe(..., { certValid: true })` form silently dropped its 3rd arg
        // — httpProbe takes only (url, status) — so no cert check ran at all.)
        certProbe("dashboard.worldwidewebb.co", { warnDays: 14 }),
        // The basemap must be present AND served over range requests with the
        // PMTiles v3 magic ("PMTiles" is the first 7 bytes) — a permanent guard
        // against the archive going missing or a non-range server shadowing it.
        cmdProbe(
          "basemap pmtiles served",
          "curl -sf -r 0-6 https://dashboard.worldwidewebb.co/maps/socal.pmtiles | grep -q PMTiles",
        ),
      ],
    }),

    // Storybook: component library, public via Cloudflare tunnel.
    service("storybook", {
      image: ghcr("control-center-storybook"),
      // 96M cap — static Storybook build served by a small http server (CC-ke9a).
      resources: { memory: "96M" },
      route: "storybook.worldwidewebb.co",
      port: 6006,
      health: [httpProbe("https://storybook.worldwidewebb.co", 200)],
    }),

    // Drizzle Gateway: self-hosted Drizzle Studio for browsing the control_center
    // Postgres, public via the Cloudflare tunnel (mirrors the evee deploy, proven
    // on homelab). Runs OUR thin wrapper image (apps/drizzle/Dockerfile), NOT the
    // raw upstream: the upstream is distroless and wants MASTERPASS in the env, but
    // bosun delivers secrets as files, so the wrapper bun --preloads
    // /run/secrets/MASTERPASS into the env before boot (without it the admin panel
    // boots ungated). The control_center connection is prefilled declaratively:
    // the wrapper also builds DATABASE_URL_control_center from the mounted Postgres
    // password (CC-my5j), which the gateway auto-seeds into a connection on a fresh
    // store — so a clean redeploy auto-connects with no manual UI add. Connections +
    // sessions persist in the drizzle-data volume; that volume is node-local, so pin
    // to the manager. The MASTERPASS secret already exists in the shared Homelab
    // vault (evee created it) — no new 1Password item.
    service("drizzle", {
      image: ghcr("control-center-drizzle"),
      // 256M cap for the self-hosted Drizzle Gateway (CC-ke9a).
      resources: { memory: "256M" },
      route: "drizzle.worldwidewebb.co",
      port: 4983,
      secrets: fromOp("Homelab", {
        MASTERPASS: "Drizzle Gateway/masterpass",
        // Lets the preload build DATABASE_URL_control_center so a fresh-volume
        // gateway auto-seeds the control_center connection (no manual UI add). The
        // password stays on the file rail; the gateway persists only a reference.
        POSTGRES_PASSWORD: "Control Center Postgres/password",
      }),
      env: {
        // Gateway server port (matches `port` above) and the persisted store path
        // (the mounted volume) so connections/sessions survive a redeploy.
        PORT: "4983",
        STORE_PATH: "/app",
      },
      volumes: ["drizzle-data:/app"],
      placement: ["node.role==manager"],
      health: [httpProbe("http://drizzle:4983", 200)],
    }),

    // Postgres: persistent named volume, pinned image, migrate-on-boot in api.
    postgres({
      volume: "pgdata",
      secretRef: "op://Homelab/Control Center Postgres/password",
      // 768M cap (the largest — it's the shared datastore) + a cpu reservation so
      // the DB stays on the critical path under contention (CC-ke9a).
      resources: { memory: "768M", reserveCpus: "0.5" },
    }),

    // Cloudflared: outbound-only tunnel connector. No host ports exposed.
    service("cloudflared", {
      image: "cloudflare/cloudflared:2025.10.1",
      // 128M cap + a small cpu reservation: the tunnel connector is the public
      // ingress, so it must stay scheduled even under load (the outage took it
      // down too) — CC-ke9a.
      resources: { memory: "128M", reserveCpus: "0.25" },
      secrets: fromOp("Homelab", {
        TUNNEL_TOKEN: "Cloudflare Tunnel evee-webhooks/connector_token",
      }),
      // The cloudflared image is shell-less (distroless), so a `$(cat ...)`
      // command substitution can't run — it would be passed to the tunnel as a
      // literal token. Use cloudflared's native --token-file, which reads the
      // docker secret mounted at /run/secrets/TUNNEL_TOKEN directly.
      command: "tunnel --no-autoupdate run --token-file /run/secrets/TUNNEL_TOKEN",
      health: [],
    }),

    // bosun-agent: the CI deploy webhook receiver. On an authenticated POST to
    // /deploy/control-center it runs `bosun up` against the host swarm, so a push
    // to main auto-deploys without CI ever reaching the tailnet (CI is the
    // trigger, the box is the executor). Needs: the docker socket (read-write —
    // it runs `docker stack deploy`/`docker secret`), so it pins to a manager
    // node; the op service-account token (to resolve secrets during its own
    // `bosun up`); and the shared webhook token (to authenticate the caller).
    // Both tokens arrive as docker secrets (files under /run/secrets); the image
    // entrypoint exports them to env, which is what cli.ts and `op` read.
    service("bosun-agent", {
      image: ghcr("control-center-bosun"),
      // 192M cap for the deploy webhook receiver + in-process scheduler (CC-ke9a).
      resources: { memory: "192M" },
      route: "hooks.worldwidewebb.co",
      port: 4202,
      // APP_ENV labels bosun's structured logs as production (CC-rw07).
      env: {
        APP_ENV: "production",
      },
      secrets: fromOp("Homelab", {
        BOSUN_WEBHOOK_TOKEN: "Bosun Webhook Token/credential",
        // 1Password item "Service Account Auth Token: Homelab", referenced by
        // UUID because op:// refs can't contain the colon in its title.
        OP_SERVICE_ACCOUNT_TOKEN: "twioy4ncbhijeahcqgqrwfoeiq/credential",
        // GHCR read token so the agent's `docker stack deploy --with-registry-auth`
        // can pull updated images on deploy. The entrypoint runs `docker login`
        // with it; without creds the bundled auth is empty and fresh pulls fail.
        GHCR_PULL_TOKEN: "GitHub Personal Access Token/token",
        // Non-secret Cloudflare identifiers so the agent's own `bosun up`
        // reconciles tunnel routes + DNS on each deploy (CC-vqyv). These are NOT
        // secrets, but they ride the docker-secret channel as the one wiring that
        // reaches the agent's env WITHOUT hardcoding them in this PUBLIC repo: the
        // entrypoint exports each /run/secrets/<name> to env (CF_ACCOUNT_ID /
        // CF_ZONE_ID / CF_TUNNEL_ID), which cli.ts reads. (The CF API *token* is a
        // real secret and is resolved separately via op at reconcile time.)
        CF_ACCOUNT_ID: "Cloudflare API/account_id",
        CF_ZONE_ID: "Cloudflare API/zone_id",
        CF_TUNNEL_ID: "Cloudflare API/tunnel_id",
        // NOTE (CC-cuuw cutover): the CF Access service-token client-ids
        // (CF_ACCESS_KIOSK_CLIENT_ID / CF_ACCESS_CI_CLIENT_ID) are added HERE as
        // two more fromOp lines at the gated cutover — NOT now. `secrets sync`
        // eagerly resolves every ref (Promise.all over op read), and op read
        // THROWS on a missing item, so adding them before
        // scripts/save-cf-access-tokens.sh creates the two 1Password items would
        // abort every deploy. The agent entrypoint already exports both names
        // (docker-entrypoint.sh) so the wiring is ready; only these refs wait for
        // the items to exist. See docs/deployment-design.md (Access gate rollout).
      }),
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
      placement: ["node.role==manager"],
      health: [httpProbe("http://bosun-agent:4202/up", 200)],
    }),

    // Nightly Docker image cleanup. Old/unused images accumulate on the Mini and
    // are never reclaimed, so a scheduled prune keeps disk in check. The bosun
    // scheduler (in bosun-agent) runs this on its cron as a one-shot Swarm job
    // (docker service create --mode replicated-job) — no third-party scheduler,
    // no always-on container. It pins to a manager node and mounts the socket to shell
    // `docker` against the host daemon. We use `image prune -a` with an
    // `until=720h` age filter (older than 30 days) rather than a bare `prune -af`:
    // the box re-pulls images on every deploy, so a conservative age filter avoids
    // evicting images we still actively use or just pulled. `-f` skips the
    // interactive confirmation a non-interactive job cannot answer.
    cronJob("docker-image-prune", {
      image: "docker:cli",
      // 03:00 local, nightly off-peak.
      schedule: "0 3 * * *",
      command: 'docker image prune -a -f --filter "until=720h"',
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
      placement: ["node.role==manager"],
    }),

    // Tesla-map basemap provisioner (CC-gma). The live map (TeslaMap.tsx) reads a
    // Protomaps .pmtiles archive over HTTP range requests from /maps/socal.pmtiles,
    // served by the web nginx off the host bind mount above. The archive is 100s of
    // MB — too large for git or the image — so it is NOT baked in: this job
    // range-extracts the region straight from the Protomaps daily planet build onto
    // the host volume the web service mounts. The recipe (bbox/maxzoom/build date)
    // lives in git for reproducibility; only the bytes stay on the host. Re-extract,
    // or expand the extent (e.g. full CA+AZ+NV), by editing the args here and
    // running `bosun run-job map-extract` — the whole map is a one-line config diff.
    //
    // The go-pmtiles image is distroless (no shell) with the pmtiles binary as its
    // entrypoint, so `command` is the bare `extract` subcommand. The schedule is
    // required by cronJob() but this job is driven MANUALLY via `run-job`; a rare
    // cron (Jan 1) keeps it declarative without risking surprise multi-GB
    // re-downloads. Protomaps retains only ~7 days of builds, so bump the date when
    // you re-provision.
    cronJob("map-extract", {
      image: "ghcr.io/protomaps/go-pmtiles:v1.30.3",
      schedule: "0 5 1 1 *",
      command:
        "extract https://build.protomaps.com/20260604.pmtiles /out/socal.pmtiles " +
        "--bbox=-121.0,32.4,-114.0,35.9 --maxzoom=15",
      volumes: ["/Users/calum/control-center/maps:/out"],
      placement: ["node.role==manager"],
    }),
  ],
});
