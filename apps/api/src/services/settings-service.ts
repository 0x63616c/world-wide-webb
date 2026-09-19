import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import { ACCENTS, SETTINGS_DEFAULTS } from "../contract/settings";
import type * as schema from "../db/schema";
import { SETTINGS_SINGLETON_ID, settings } from "../db/schema";

// ─── shape + validation ────────────────────────────────────────────────────────

// The global wall-panel settings blob. This is the byte-for-byte contract the web
// client reads/writes; field names and types MUST NOT drift. Stored as a single
// jsonb `value` on the settings singleton row (services own the shape, not the DB).
//
// The vocabulary and bounds below come from ../contract/settings, which the web
// client imports too (via @cc/api/settings) , that shared module is what makes
// the "MUST NOT drift" rule above enforceable rather than aspirational. Only the
// FIELD LIST is still stated twice (this zod object vs web's Settings interface).

export const settingsSchema = z.object({
  // The synced soft-lock PIN. NOT auth , the API only enforces the 6-digit shape
  // and never validates or logs the value.
  pinCode: z.string().regex(/^\d{6}$/),
  // The board's highlight colour. Only the KEY is contract , the hex ramp each
  // key maps to is web's business (lib/accent.ts).
  accent: z.enum(ACCENTS),
  // An IANA name, not a browser/host offset. An offset changes with DST and
  // cannot correctly identify a calendar day across a future transition.
  timeZone: z.string().refine(
    (value) => {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "must be a recognised IANA time zone" },
  ),
});

/** A partial patch: any subset of the full settings object. */
export const settingsPatchSchema = settingsSchema.partial();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Baseline settings returned when no row exists yet, and the merge floor for
 *  every read/write so a newly-added field falls back to its default. Shared with
 *  the web store, which layers its device-local fields on top. */
export const DEFAULTS: Settings = SETTINGS_DEFAULTS;

type Database = NodePgDatabase<typeof schema>;

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Read the global settings singleton. Returns DEFAULTS when the row is absent
 * (or the DB is unreadable). When present, the stored value is merged OVER
 * DEFAULTS (so a field added after the row was written falls back to its default,
 * and a field retired since the row was written is silently dropped by zod) and
 * re-validated through settingsSchema.
 */
export async function getSettings(db: Database): Promise<Settings> {
  try {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.id, SETTINGS_SINGLETON_ID))
      .limit(1);
    const stored = rows[0]?.value;
    if (!stored || typeof stored !== "object") return DEFAULTS;
    return settingsSchema.parse({ ...DEFAULTS, ...stored });
  } catch (err) {
    getLogger().warn({ err }, "getSettings: read failed, returning defaults");
    return DEFAULTS;
  }
}

/**
 * Apply a partial patch to the global settings singleton and return the new full
 * Settings. Reads current (or DEFAULTS), merges the patch, validates, then upserts
 * the whole blob via insert().onConflictDoUpdate on the singleton id.
 */
export async function updateSettings(db: Database, patch: SettingsPatch): Promise<Settings> {
  const current = await getSettings(db);
  const next = settingsSchema.parse({ ...current, ...patch });
  const now = new Date();
  await db
    .insert(settings)
    .values({ id: SETTINGS_SINGLETON_ID, value: next, updatedAtUtc: now })
    .onConflictDoUpdate({
      target: settings.id,
      set: { value: next, updatedAtUtc: now },
    });
  getLogger().info({ patch }, "updateSettings: settings persisted");
  return next;
}
