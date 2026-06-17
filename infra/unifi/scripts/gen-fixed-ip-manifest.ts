#!/usr/bin/env bun
// Generate the off-repo fixed-IP manifest from the LIVE UniFi controller
// (www-j934.3.1). This is the single source of truth for which clients the
// adopt-only Pulumi program treats as DHCP reservations: a reservation is
// EXACTLY a client with `use_fixedip === true`, nothing else. Running this
// re-derives the manifest from reality, so it can never silently drift back to
// the hand-curated state that mixed in 19 non-reservations and dropped the
// portal host (homeassistant .147).
//
// Usage (creds from SOPS vault, never committed):
//   UNIFI_API_URL=https://192.168.0.1 \
//   UNIFI_API_KEY=<local_api_key from UNIFI__LOCAL_API_KEY> \
//   bun infra/unifi/scripts/gen-fixed-ip-manifest.ts
//
// Writes to $UNIFI_FIXED_IP_MANIFEST or ~/cc-j934-unifi-baseline/fixed-ip-manifest.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type RawUnifiUser, selectFixedIpReservations } from "../src/manifest.ts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} must be set (inject from SOPS vault via scripts/secrets.sh).`);
  }
  return v;
}

const apiUrl = requireEnv("UNIFI_API_URL").replace(/\/+$/, "");
const apiKey = requireEnv("UNIFI_API_KEY");
const site = process.env.UNIFI_SITE ?? "default";
const outPath =
  process.env.UNIFI_FIXED_IP_MANIFEST ??
  join(homedir(), "cc-j934-unifi-baseline", "fixed-ip-manifest.json");

const res = await fetch(`${apiUrl}/proxy/network/api/s/${site}/rest/user`, {
  headers: { "X-API-KEY": apiKey, Accept: "application/json" },
  // The UCG-Fiber serves the controller over a self-signed cert.
  tls: { rejectUnauthorized: false },
});

if (!res.ok) {
  throw new Error(`UniFi rest/user returned ${res.status}: ${await res.text()}`);
}

const body = (await res.json()) as { data?: RawUnifiUser[] };
const users = body.data ?? [];
const reservations = selectFixedIpReservations(users);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(reservations, null, 2)}\n`);

// Names only (MACs are network-internal; keep them off stdout/CI logs).
console.log(
  `Wrote ${reservations.length} fixed-IP reservation(s) to ${outPath} ` +
    `(of ${users.length} client records):`,
);
for (const r of reservations) {
  console.log(`  - ${r.logicalName}${r.name ? ` (${r.name})` : ""}`);
}
