/**
 * The wall-panel settings CONTRACT , the single definition of the vocabulary and
 * bounds that both sides of the wire must agree on.
 *
 * This module has ZERO imports, deliberately. It is re-exported through
 * `packages/api` (`@cc/api/settings`) and therefore lands in the browser bundle,
 * so anything reachable from here ships to the panel. Keep it plain literals:
 * no zod, no drizzle, no logger. The api's settings-service builds its zod
 * schema from these values; the web store builds its clamps and its picker from
 * the same ones.
 *
 * It exists because settings-service's own header calls this blob "the
 * byte-for-byte contract the web client reads/writes; field names and types MUST
 * NOT drift" , and until now nothing enforced that.
 *
 * The Simplification (§6) cut this down to three synced fields. Idle dim,
 * lock screen, snap mode, the minimap, the PIN-pad layout, the typeface and
 * the goal-day cutoff are gone — idle dim, brightness and typeface are now
 * hardcoded constants (`apps/web/src/lib/settings.ts`), and the rest had no
 * surviving consumer at all. Only `pinCode`, `accent` and `timeZone` remain
 * synced settings.
 */

// ─── accent vocabulary ────────────────────────────────────────────────────────
// The single highlight colour the panel is built around (every `--acc*` token
// derives from it). Only the KEY is wire contract; the hex ramp each key maps to
// is a rendering concern and lives in web's lib/accent.ts.
export const ACCENTS = ["blue", "white", "green", "orange"] as const;
export type Accent = (typeof ACCENTS)[number];

/** The panel's initial local calendar zone. The persisted setting may replace it. */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

// ─── defaults ─────────────────────────────────────────────────────────────────

/** Every SYNCED setting and its default , the baseline the server returns when
 *  no row exists, and the merge floor on every read/write so a field added after
 *  a row was written falls back sanely. */
export const SETTINGS_DEFAULTS = {
  pinCode: "000000",
  accent: "white",
  timeZone: DEFAULT_TIME_ZONE,
} as const satisfies Record<string, unknown>;
