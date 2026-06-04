// Control-center deployment manifest. Pure data — no I/O, no side effects.
// Secret refs point at 1Password items; values are resolved at sync time only.
// See docs/deployment-design.md Part 6 for the full spec.

import {
  cmdProbe,
  cronJob,
  fromOp,
  ghcr,
  httpProbe,
  ofeliaController,
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
      // Token is injected via docker secret mounted at /run/secrets/TUNNEL_TOKEN.
      command: "tunnel --no-autoupdate run --token $(cat /run/secrets/TUNNEL_TOKEN)",
      health: [],
    }),

    // Ofelia: the single scheduler pod that runs every cronJob() below off its
    // ofelia.* deploy labels. Reconciled like any service; mounts the docker
    // socket and pins to a manager node. See packages/bosun/README.md for the
    // socket/SPOF tradeoff.
    ofeliaController(),

    // Nightly Docker image cleanup. Old/unused images accumulate on the Mini and
    // are never reclaimed, so a scheduled prune keeps disk in check. Runs as a
    // one-shot docker:cli container (job-run) with the socket mounted so it can
    // shell `docker` against the host daemon. We use `image prune -a` with an
    // `until=720h` age filter (older than 30 days) rather than a bare `prune -af`:
    // the box re-pulls images on every deploy, so a conservative age filter avoids
    // evicting images we still actively use or just pulled. `-f` skips the
    // interactive confirmation Ofelia cannot answer.
    cronJob("docker-image-prune", {
      image: "docker:cli",
      // 03:00 local, nightly off-peak.
      schedule: "0 3 * * *",
      command: 'docker image prune -a -f --filter "until=720h"',
      volumes: ["/var/run/docker.sock:/var/run/docker.sock"],
    }),
  ],
});
