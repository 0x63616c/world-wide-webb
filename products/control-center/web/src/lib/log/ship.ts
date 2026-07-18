/**
 * Frontend log shipper (spec 2026-07-18-frontend-log-shipping-design).
 *
 * The panel's logs live only on the device (IndexedDB + native JSONL mirror).
 * This drains them to the control-center Postgres (`frontend_log`) via the
 * `logs.ingest` tRPC mutation, so they can be read from a desk with SQL instead
 * of standing at the panel.
 *
 * Transport model is a tracked cursor + frontend push: we remember the last
 * shipped entry id (localStorage, per device) and push everything after it,
 * ascending. IndexedDB IS the retry queue , there is no separate buffer. An
 * offline window simply backfills on reconnect (the store keeps the rows), and a
 * lost cursor (evicted storage) re-ships from the start, which is harmless: the
 * backend PK is `(device_id, entry_id)` with `on conflict do nothing`, so resends
 * never double-insert and never error.
 *
 * Best-effort, exactly like the native mirror: a shipping failure must never
 * touch logging itself. shipOnce() swallows every error, halts the run, and
 * relies on the next flush tick to retry. It logs its OWN health sparingly (first
 * failure after a healthy run, and clearing a real backlog) under the "log-ship"
 * source, never per tick.
 *
 * Self-reference: the shipper's own tRPC call would, through the app's logging
 * link/fetch, generate new log entries , which would then need shipping, forever.
 * So the ship client DELIBERATELY bypasses loggingLink/loggingFetch (plain client
 * below). The only entries the shipper produces are its sparse own-health lines,
 * which ship once and generate nothing further, so the backlog still converges to
 * empty. This also keeps the raw per-request debug noise out of the shipped table.
 */

import type { AppRouter } from "@cc/api/trpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { getDeviceId } from "../device-id";
import { log, onFlushed } from "./logger";
import type { LogQuery } from "./store";
import * as store from "./store";
import type { LogEntry } from "./types";

/** Backend cap per ingest call; also our page size draining the store. */
const BATCH_SIZE = 500;
/**
 * Batches shipped per run. Caps catch-up work so a long backlog drains over a few
 * minutes of ticks (10 * 500 = 5000 entries/run at a 3s cadence) without hogging
 * the panel's main thread or firing one giant request.
 */
const MAX_BATCHES_PER_RUN = 10;
/** Per-device cursor key: the last entry id we have confirmed shipped. */
const CURSOR_PREFIX = "cc-logs:ship-cursor:";
/** Own-health log source, so the shipper's lines are identifiable (and grep-able). */
const SHIP_SOURCE = "log-ship";

const shipLog = log.child(SHIP_SOURCE);

// ─── transport ─────────────────────────────────────────────────────────────────

/** Ship one batch for a device. The real impl posts to `logs.ingest`. */
export type ShipTransport = (deviceId: string, entries: LogEntry[]) => Promise<void>;

/**
 * Standalone tRPC client for the shipper , NOT the React hooks client, and NOT
 * wired through loggingLink/loggingFetch (see the module header on why the
 * shipper must not log its own requests). Plain global fetch, same-origin `/trpc`
 * (Vite proxies it in dev; same origin in prod), same batch link as the app.
 */
const shipClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});

const defaultTransport: ShipTransport = async (deviceId, entries) => {
  // Extra LogEntry fields (`seq`, `truncated`) are stripped by the ingest zod
  // schema; the wire shape it validates is a subset of LogEntry.
  await shipClient.logs.ingest.mutate({ deviceId, entries });
};

// ─── cursor persistence (best-effort localStorage) ──────────────────────────────

function cursorKey(deviceId: string): string {
  return `${CURSOR_PREFIX}${deviceId}`;
}

function readCursor(deviceId: string): string | undefined {
  try {
    return window.localStorage?.getItem(cursorKey(deviceId)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(deviceId: string, id: string): void {
  try {
    window.localStorage?.setItem(cursorKey(deviceId), id);
  } catch {
    // Best-effort , a cursor we cannot persist just re-ships next boot, which the
    // backend dedups. Losing the cursor is safe by construction, so is not saving it.
  }
}

// ─── run loop ────────────────────────────────────────────────────────────────────

/** Injectable seams so tests drive the loop without a store, network, or storage. */
export interface ShipDeps {
  getDeviceId(): string;
  query(q: LogQuery): Promise<LogEntry[]>;
  transport: ShipTransport;
  readCursor(deviceId: string): string | undefined;
  writeCursor(deviceId: string, id: string): void;
}

const defaultDeps: ShipDeps = {
  getDeviceId,
  query: store.query,
  transport: defaultTransport,
  readCursor,
  writeCursor,
};

// A run in flight: the flush hook fires every ~3s, but a catch-up run can outlast
// that, so overlapping runs are skipped (the next tick picks up where this left).
let running = false;
// Was the last shipping attempt healthy? Gates first-failure logging so a
// sustained outage logs once, not every tick.
let healthy = true;

function errorShape(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { value: String(err) };
}

/**
 * Ship everything after the cursor, ascending, up to MAX_BATCHES_PER_RUN batches.
 * Advances and persists the cursor per batch, so a mid-run failure keeps the
 * progress it made and the next tick resumes from there. Throws on the first
 * failing batch (transport or store read) so shipOnce halts the run.
 */
async function runShipping(deps: ShipDeps): Promise<void> {
  const deviceId = deps.getDeviceId();
  let cursor = deps.readCursor(deviceId);
  let batches = 0;

  while (batches < MAX_BATCHES_PER_RUN) {
    // No cursor (first run / evicted storage) → "" ships from the very start:
    // every real id sorts strictly after "", so lowerBound("", open) is the whole
    // store ascending. The backend dedups the resend.
    const batch = await deps.query({ after: cursor ?? "", limit: BATCH_SIZE });
    if (batch.length === 0) break;

    // A throw here (offline / server error) leaves the cursor un-advanced past the
    // failed batch, so nothing is skipped , shipOnce catches it and retries later.
    await deps.transport(deviceId, batch);

    cursor = batch[batch.length - 1]?.id;
    if (cursor !== undefined) deps.writeCursor(deviceId, cursor);
    batches++;
    if (batch.length < BATCH_SIZE) break; // fewer than a full page → store drained
  }

  // Shipped cleanly this run. Note recovery, or clearing a real (multi-batch)
  // backlog, once at debug , never for a steady-state single-batch tick.
  if (batches > 0) {
    if (!healthy || batches > 1) shipLog.debug("shipping caught up", { batches });
    healthy = true;
  }
}

/**
 * Run one shipping pass. NEVER throws or rejects , shipping is best-effort and
 * must not disturb logging or the flush hook it rides on. Any failure (transport,
 * store read, anything) halts the run to retry next tick and logs only the first
 * failure after a healthy run. Re-entrant calls are ignored while a run is in
 * flight (a catch-up run can outlast the 3s flush cadence).
 */
export async function shipOnce(deps: ShipDeps = defaultDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runShipping(deps);
  } catch (err) {
    if (healthy) {
      shipLog.debug("shipping paused, will retry", errorShape(err));
      healthy = false;
    }
  } finally {
    running = false;
  }
}

/**
 * Start the shipper: run once after every flush that lands in the store. Called
 * from log/boot.ts (app boot only), so Storybook/tests never start it implicitly.
 * Returns an unsubscribe. Off-device (browser/Storybook) it ships too , web
 * sessions have a `web-*` device id and are a real log source.
 */
export function startShipping(): () => void {
  return onFlushed(() => {
    void shipOnce();
  });
}

/** Test seam: forget the in-flight/health state so a test starts from a clean run. */
export function resetShipForTests(): void {
  running = false;
  healthy = true;
}
