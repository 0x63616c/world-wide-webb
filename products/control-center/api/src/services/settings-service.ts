import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import type * as schema from "../db/schema";
import { SETTINGS_SINGLETON_ID, settings } from "../db/schema";

// ─── shape + validation ────────────────────────────────────────────────────────

// The global wall-panel settings blob. This is the byte-for-byte contract the web
// client reads/writes; field names and types MUST NOT drift. Stored as a single
// jsonb `value` on the settings singleton row (services own the shape, not the DB).

/** Valid snap-drag behaviors for the tile board. */
export const SnapMode = {
  Proximity: "proximity",
  Mandatory: "mandatory",
  MandatorySettle: "mandatory-settle",
  None: "none",
  Spring: "spring",
} as const;
export type SnapMode = (typeof SnapMode)[keyof typeof SnapMode];

/** Valid board color themes. Auto follows the sun at the home location. */
export const ThemeMode = {
  Auto: "auto",
  Light: "light",
  Dark: "dark",
} as const;
export type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode];

// Idle-dim and recenter timeouts share the same valid window: 1 minute .. 1 hour.
const TIMEOUT_MIN_MS = 60_000;
const TIMEOUT_MAX_MS = 3_600_000;

// Theme/dim fades cap at 10s; sunset offset stays within ±2 hours of the event.
const FADE_MIN_MS = 0;
const FADE_MAX_MS = 10_000;
const SUN_OFFSET_MIN_MIN = -120;
const SUN_OFFSET_MAX_MIN = 120;

export const settingsSchema = z.object({
  /** Active (awake) backlight the panel drives itself, overriding the OS
   *  brightness. 0.01..1 (1% .. 100%). Idle drops from here to idleDimLevel. */
  activeBrightness: z.number().min(0.01).max(1),
  idleDimEnabled: z.boolean(),
  idleDimTimeoutMs: z.number().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
  idleDimLevel: z.number().min(0.01).max(0.99),
  recenterEnabled: z.boolean(),
  recenterTimeoutMs: z.number().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
  showFps: z.boolean(),
  showBuildBadge: z.boolean(),
  snapMode: z.enum([
    SnapMode.Proximity,
    SnapMode.Mandatory,
    SnapMode.MandatorySettle,
    SnapMode.None,
    SnapMode.Spring,
  ]),
  /** Board color theme. `auto` tracks the sun: light after sunrise, dark after
   *  sunset (shifted by themeSunOffsetMin), from the home-location sun times
   *  already ingested with the weather. */
  themeMode: z.enum([ThemeMode.Auto, ThemeMode.Light, ThemeMode.Dark]),
  /** Auto-theme switch offset in minutes relative to sunrise/sunset. Positive
   *  switches later (e.g. +30 ≈ wait for civil twilight to end). */
  themeSunOffsetMin: z.number().min(SUN_OFFSET_MIN_MIN).max(SUN_OFFSET_MAX_MIN),
  /** Light↔dark cross-fade duration in ms (0 = instant). */
  themeFadeMs: z.number().min(FADE_MIN_MS).max(FADE_MAX_MS),
  /** Idle-dim backlight ramp duration in ms (0 = instant). */
  dimFadeMs: z.number().min(FADE_MIN_MS).max(FADE_MAX_MS),
});

/** A partial patch: any subset of the full settings object. */
export const settingsPatchSchema = settingsSchema.partial();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Baseline settings returned when no row exists yet, and the merge floor for
 *  every read/write so a newly-added field falls back to its default. */
export const DEFAULTS: Settings = {
  activeBrightness: 1,
  idleDimEnabled: true,
  idleDimTimeoutMs: 600_000,
  idleDimLevel: 0.25,
  recenterEnabled: true,
  recenterTimeoutMs: 600_000,
  showFps: false,
  showBuildBadge: true,
  snapMode: SnapMode.MandatorySettle,
  // Dark default preserves the panel's historical look until a user opts in.
  themeMode: ThemeMode.Dark,
  themeSunOffsetMin: 30,
  themeFadeMs: 1200,
  dimFadeMs: 1000,
};

type Database = NodePgDatabase<typeof schema>;

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Read the global settings singleton. Returns DEFAULTS when the row is absent
 * (or the DB is unreadable). When present, the stored value is merged OVER
 * DEFAULTS (so a field added after the row was written falls back to its default)
 * and re-validated through settingsSchema.
 */
export async function getSettings(db: Database): Promise<Settings> {
  try {
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.id, SETTINGS_SINGLETON_ID))
      .limit(1);
    const stored = rows[0]?.value;
    if (!stored) return DEFAULTS;
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
