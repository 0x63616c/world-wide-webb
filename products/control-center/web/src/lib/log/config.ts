/**
 * Device-local logging config.
 *
 * Deliberately NOT part of the synced `Settings` store (lib/settings.ts): that
 * object is pushed to the api and mirrored onto every panel, and payload capture
 * is a per-device debugging decision, not a global preference. Keeping it here
 * also means turning it on needs no api deploy.
 *
 * Payload capture is OFF by default. The tRPC link always records procedure,
 * duration, status and error shape; it records request/response BODIES only when
 * this is on. An always-on logger writing bodies would persist Tesla
 * coordinates, camera stream URLs and auth tokens in plaintext IndexedDB on a
 * wall-mounted device, indefinitely , and docs/logging.md §4 ("Redaction,
 * secrets are NEVER logged") is the repo's standing rule for the backend. The
 * frontend should not quietly diverge from it. When you need bodies to chase a
 * bug, you turn this on, and you know what you turned on.
 */

const KEY = "cc-log-payloads";

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): boolean {
  try {
    return window.localStorage?.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

let logPayloads = read();

export function getLogPayloads(): boolean {
  return logPayloads;
}

export function setLogPayloads(v: boolean): void {
  if (logPayloads === v) return;
  logPayloads = v;
  try {
    window.localStorage?.setItem(KEY, String(v));
  } catch {
    // best-effort, same convention as lib/settings.ts
  }
  for (const cb of listeners) cb();
}

export function subscribeLogPayloads(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
