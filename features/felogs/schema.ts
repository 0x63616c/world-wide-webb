// Frontend log shipping (spec 2026-07-18-frontend-log-shipping-design), folded
// into the felogs feature (Track C, Wave 7). The wall panel and other devices
// mirror their on-device frontend logs (IndexedDB + the native JSONL file)
// into Postgres so they're queryable from a desk via SQL instead of only
// readable standing at the panel. The frontend tracks a cursor (last shipped
// entry_id) and pushes everything after it; offline windows backfill on
// reconnect. Ingest is idempotent by construction via the composite PK —
// entry ids (`bootMs-seq`) are only unique per device, so identity is
// (device_id, entry_id), and resends / cursor resets `on conflict do nothing`.
// All four levels ship; retention (30 days, jobs.ts purgeCron) is the size
// control, not level filtering.
//
// EXPORTED for `interaction-session-service` (apps/api, staying put until the
// wakes fold) to read via `@features/felogs/schema` — the sanctioned
// `apps/api -> @features` direction.
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const frontendLog = pgTable(
  "frontend_log",
  {
    deviceId: text("device_id").notNull(), // stable id, e.g. "ipad13-1-3f9a2c1b" / "web-<8hex>"
    entryId: text("entry_id").notNull(), // `bootMs-seq`, lexicographically ordered per device
    ts: timestamp("ts", { withTimezone: true }).notNull(), // capture time
    level: text("level").notNull(), // debug | info | warn | error
    source: text("source").notNull(),
    msg: text("msg").notNull(),
    data: jsonb("data"), // nullable structured payload
    sha: text("sha").notNull(), // git sha of the web bundle
    build: text("build").notNull(), // app build number ("80") or "web"
    deviceName: text("device_name").notNull(), // display label at capture time
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.entryId] }),
    // Time-range reads ("last day of warn/error") drive the query surface; the
    // bare ts index serves ts-only scans, (level, ts) the level-filtered ones.
    index("frontend_log_ts_idx").on(t.ts),
    index("frontend_log_level_ts_idx").on(t.level, t.ts),
    // The sessions aggregate (interaction-session-service) reads ui-channel
    // rows by their JSONB session id , without this partial expression index
    // every per-session lookup is a full scan of a table that holds 30 days of
    // EVERY device's debug logs. Partial on source='ui' keeps it tiny: only
    // interaction rows are indexed, and the service always filters on both.
    index("frontend_log_ui_session_idx")
      .on(sql`(${t.data}->>'interactionSessionId')`)
      .where(sql`${t.source} = 'ui'`),
  ],
);
