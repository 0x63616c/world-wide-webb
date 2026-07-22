// Bridge: Drizzle Gateway (distroless) reads its config from the ENVIRONMENT, but
// bosun delivers every secret as a FILE under /run/secrets (the same constraint
// that makes the bosun-agent export its secret files in docker-entrypoint.sh, and
// that cloudflared works around with --token-file). The gateway image has no shell
// to cat the files itself, so this module is bun --preloaded ahead of the gateway
// entrypoint and loads the docker-secrets into process.env before boot. This keeps
// the values on the encrypted file rail: they never land in the image or the Swarm
// service spec.
import { readFileSync } from "node:fs";

// biome-ignore lint/style/noProcessEnv: bridging docker-secret files into the gateway's env is the entire purpose of this preload.
const env = process.env;

function readSecret(name) {
  try {
    const value = readFileSync(`/run/secrets/${name}`, "utf8").trim();
    return value || undefined;
  } catch {
    // No secret mounted (e.g. a bare local run) , return undefined so the caller
    // can no-op rather than crash. In prod the secrets are always present.
    return undefined;
  }
}

// MASTERPASS gates the admin UI. Absent (local run) -> gateway boots ungated.
const masterpass = readSecret("MASTERPASS");
if (masterpass) env.MASTERPASS = masterpass;

// Prefill the control_center Postgres connection declaratively: the gateway seeds
// a connection from any DATABASE_URL_<name> env var on a FRESH store (guarded by
// its store id), naming the slot <name> and storing only a ${DATABASE_URL_...}
// reference (never the plaintext password in the volume). We build it here from
// the mounted password file so a clean redeploy auto-connects with no UI step.
// host/port/db/user mirror products/control-center/api/src/env.ts defaults (the overlay service name).
const pgPassword = readSecret("POSTGRES_PASSWORD");
if (pgPassword) {
  env.DATABASE_URL_control_center = `postgresql://postgres:${encodeURIComponent(pgPassword)}@postgres:5432/control_center`;
}
