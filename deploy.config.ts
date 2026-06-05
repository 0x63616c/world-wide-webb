// Control-center deployment manifest. Pure data — no I/O, no side effects.
// Secret refs point at 1Password items; values are resolved at sync time only.
// See docs/deployment-design.md Part 6 for the full spec.

import {
  cmdProbe,
  cronJob,
  fromOp,
  ghcr,
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
      secrets: fromOp("Homelab", {
        HA_TOKEN: "Home Assistant Token/credential",
        UNIFI_API_KEY: "UniFi/local_api_key",
        WIFI_SSID: "WiFi Guest Credentials/ssid",
        WIFI_PASSWORD: "WiFi Guest Credentials/password",
        POSTGRES_PASSWORD: "Control Center Postgres/password",
      }),
      env: {
        NODE_ENV: "production",
        // Fixed-location LA wall panel: run the API in Pacific time so the
        // weather ingest parses Open-Meteo's timezone=auto LA-local timestamps
        // correctly and read-time hour labels match the board's local clock.
        // Without this the container defaults to UTC and weather is shifted 7h.
        TZ: "America/Los_Angeles",
        // Home Assistant is on the host via OrbStack's host alias.
        HA_URL: "http://host.docker.internal:8123",
        UNIFI_URL: "https://host.docker.internal",
        // DATABASE_URL is built at runtime from the mounted POSTGRES_PASSWORD
        // docker secret (apps/api/src/env.ts) so the password never lands in
        // the service spec. postgres host/db/user use the env.ts defaults.
      },
      port: 4201,
      health: [
        httpProbe("http://api:4201/up", 200),
        cmdProbe("live HA data", "curl -sf http://api:4201/api/climate.now | jq -e .tempC"),
      ],
    }),

    // Web: static build + /api reverse-proxy, public via Cloudflare tunnel.
    service("web", {
      image: ghcr("control-center-web"),
      route: "dashboard.worldwidewebb.co",
      proxyApiTo: "api:4201",
      port: 80,
      health: [httpProbe("https://dashboard.worldwidewebb.co", 200, { certValid: true })],
    }),

    // Storybook: component library, public via Cloudflare tunnel.
    service("storybook", {
      image: ghcr("control-center-storybook"),
      route: "storybook.worldwidewebb.co",
      port: 6006,
      health: [httpProbe("https://storybook.worldwidewebb.co", 200)],
    }),

    // Postgres: persistent named volume, pinned image, migrate-on-boot in api.
    postgres({
      volume: "pgdata",
      config: ["infra/postgres/postgresql.conf"],
      init: ["infra/postgres/initdb"],
      secretRef: "op://Homelab/Control Center Postgres/password",
    }),

    // Cloudflared: outbound-only tunnel connector. No host ports exposed.
    service("cloudflared", {
      image: "cloudflare/cloudflared:2025.10.1",
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
      route: "hooks.worldwidewebb.co",
      port: 4202,
      secrets: fromOp("Homelab", {
        BOSUN_WEBHOOK_TOKEN: "Bosun Webhook Token/credential",
        // 1Password item "Service Account Auth Token: Homelab", referenced by
        // UUID because op:// refs can't contain the colon in its title.
        OP_SERVICE_ACCOUNT_TOKEN: "twioy4ncbhijeahcqgqrwfoeiq/credential",
        // GHCR read token so the agent's `docker stack deploy --with-registry-auth`
        // can pull updated images on deploy. The entrypoint runs `docker login`
        // with it; without creds the bundled auth is empty and fresh pulls fail.
        GHCR_PULL_TOKEN: "GitHub Personal Access Token/token",
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

    // TEMPORARY (CC-lnq crash-recovery proof): an every-minute job that sleeps
    // long enough to kill the scheduler agent mid-run and observe it recover
    // (swarm keeps this task running; the restarted scheduler reads the slot
    // label / in-flight task and does NOT double-fire). REMOVE after the proof.
    cronJob("crash-test", {
      image: "docker:cli",
      schedule: "* * * * *",
      command: 'sh -c "echo crash-test running; sleep 150; echo crash-test done"',
      placement: ["node.role==manager"],
    }),
  ],
});
