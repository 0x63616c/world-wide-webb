// Bridge: Drizzle Gateway (distroless) reads MASTERPASS from the environment, but
// bosun delivers every secret as a FILE under /run/secrets (the same constraint
// that makes the bosun-agent export its secret files in docker-entrypoint.sh, and
// that cloudflared works around with --token-file). The gateway image has no shell
// to cat the file itself, so this module is bun --preloaded ahead of the gateway
// entrypoint and loads the MASTERPASS docker-secret into process.env before boot.
// This keeps the value on the encrypted file rail: it never lands in the image or
// the Swarm service spec.
import { readFileSync } from "node:fs";

const file = "/run/secrets/MASTERPASS";
try {
  const value = readFileSync(file, "utf8").trim();
  // biome-ignore lint/style/noProcessEnv: bridging the docker-secret file into the gateway's env is the entire purpose of this preload.
  if (value) process.env.MASTERPASS = value;
} catch {
  // No secret mounted (e.g. a bare local run): leave MASTERPASS unset so the
  // gateway boots ungated rather than crashing. In prod the secret is always
  // present, so the admin gate is always set.
}
