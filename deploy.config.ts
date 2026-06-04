// Control-center deployment manifest. Pure data — no I/O, no side effects.
// Secret refs point at 1Password items; values are resolved at sync time only.
// See docs/deployment-design.md Part 6 for the full spec.

import {
  cmdProbe,
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
        // Home Assistant is on the host via OrbStack's host alias.
        HA_URL: "http://host.docker.internal:8123",
        UNIFI_URL: "https://host.docker.internal",
        DATABASE_URL: "postgresql://postgres:$(POSTGRES_PASSWORD)@postgres:5432/control_center",
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
  ],
});
