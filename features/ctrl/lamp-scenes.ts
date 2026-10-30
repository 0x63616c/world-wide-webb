/**
 * Curated lamp scene palette config.
 *
 * Scenes write desired colors for the Enforcer to drive across every lamp:
 *  - white → uniform white via color_temp_kelvin, at the panel's stored
 *            temperature (warm by default, adjustable from the Controls page)
 *  - red   → uniform red in the Hue-native xy mode
 *  - blue  → uniform blue in the Hue-native xy mode
 *  - mood  → EACH lamp gets a DIFFERENT color, assigned RANDOMLY from
 *            MOOD_PALETTE on every invocation (no repeats , each lamp is
 *            unique). The point of "mood" is a varied purples/blues/party wash
 *            that's different every time you tap it.
 */

export const LampScene = {
  White: "white",
  Mood: "mood",
  Red: "red",
  Blue: "blue",
} as const;
export type LampScene = (typeof LampScene)[keyof typeof LampScene];

export type RgbColor = readonly [number, number, number];

/**
 * Color temperature bounds for the "white" scene. Hue white-ambiance lamps
 * span 2000K (candle) to 6500K (daylight); anything outside is clamped before
 * it is stored or sent.
 */
export const WHITE_KELVIN_MIN = 2000;
export const WHITE_KELVIN_MAX = 6500;

/**
 * Starting color temperature for the "white" scene, used until the panel
 * stores its own (setWhiteKelvin). 2700K is the warm, incandescent "homey"
 * white: the 4000K it replaced read too sterile in a photo of the lit
 * apartment from outside, and 5000K before that had a plain blue cast.
 * activeScene white-detection is "every on-lamp is in kelvin mode" (only the
 * white scene writes a kelvin color), so no tolerance tracks this value.
 */
export const DEFAULT_WHITE_SCENE_KELVIN = 2700;

/** Clamp a requested white temperature into the lamps' supported range, whole kelvin. */
export function clampWhiteKelvin(kelvin: number): number {
  return Math.round(Math.min(WHITE_KELVIN_MAX, Math.max(WHITE_KELVIN_MIN, kelvin)));
}

export const RED_RGB: RgbColor = [255, 0, 0];
export const BLUE_RGB: RgbColor = [0, 0, 255];

/**
 * Curated purples/blues/party palette for the "mood" scene. Must hold at least
 * as many DISTINCT colors as there are lamps so every lamp can get a unique
 * one. Colors are assigned randomly per invocation (see assignMoodColors).
 */
export const MOOD_PALETTE: readonly RgbColor[] = [
  [148, 0, 211], // violet
  [75, 0, 130], // indigo
  [0, 90, 255], // electric blue
  [255, 0, 144], // hot pink
  [0, 200, 180], // teal
  [120, 40, 220], // purple
  [0, 160, 255], // azure
  [220, 0, 255], // magenta
] as const;

/**
 * Fisher-Yates shuffle returning a NEW array. `rng` defaults to Math.random but
 * is injectable so the shuffle is deterministic (testable) when needed.
 */
function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick `count` UNIQUE mood colors, randomly assigned. Shuffles the palette and
 * takes the first `count` , so each lamp gets a distinct color and the mapping
 * is different on every call. `count` must be ≤ MOOD_PALETTE.length (guaranteed
 * by config: the palette holds at least one color per lamp).
 */
export function assignMoodColors(count: number, rng: () => number = Math.random): RgbColor[] {
  return shuffle(MOOD_PALETTE, rng).slice(0, count);
}

// ─── party mode ────────────────────────────────────────────────────────────────

/**
 * Persistent ANIMATED lamp mode (distinct from the momentary scenes above).
 * "none" = no animation; "party" = the rolling color wave. Stored in the
 * lamp_mode DB row and reconciled by the worker (www-7d5b.3.x).
 */
export const LampMode = {
  None: "none",
  Party: "party",
} as const;
export type LampMode = (typeof LampMode)[keyof typeof LampMode];

/** Party animation speed. Maps to a tick interval + crossfade transition. */
export const LampModeSpeed = {
  Slow: "slow",
  Medium: "medium",
  Fast: "fast",
} as const;
export type LampModeSpeed = (typeof LampModeSpeed)[keyof typeof LampModeSpeed];

export interface LampModeSpeedConfig {
  /** ms between color-advance ticks. */
  intervalMs: number;
  /** HA `transition` (seconds) per tick , a crossfade ~10% under the interval so
   *  each fade settles before the next command, giving a continuous flow. */
  transitionS: number;
}

/**
 * Speed presets. Ratio between steps is 2x (slow=4×fast). transition stays
 * ~10% under the interval. Hue bridge handles 7 lamps at 4000ms safely.
 */
export const LAMP_MODE_SPEED_CONFIG: Record<LampModeSpeed, LampModeSpeedConfig> = {
  [LampModeSpeed.Slow]: { intervalMs: 16000, transitionS: 14.0 },
  [LampModeSpeed.Medium]: { intervalMs: 8000, transitionS: 7.0 },
  [LampModeSpeed.Fast]: { intervalMs: 4000, transitionS: 3.5 },
};

/**
 * Ordered party palette , the color CYCLE each lamp walks through. Order is the
 * wave sequence (tweakable for feel); a spectrum-ish flow reads best. Includes
 * the canonical red/green/blue/orange plus magenta/cyan for a fuller rainbow.
 * Unlike MOOD_PALETTE this is NOT shuffled: the wave is deterministic.
 */
export const PARTY_PALETTE: readonly RgbColor[] = [
  [255, 0, 0], // red
  [255, 140, 0], // orange
  [0, 255, 0], // green
  [0, 255, 255], // cyan
  [0, 0, 255], // blue
  [255, 0, 255], // magenta
] as const;

/**
 * Deterministic color wave: at `tick`, lamp `i` shows
 * PARTY_PALETTE[(i + tick) % N]. Adjacent lamps are phase-offset by one color,
 * and each tick advances every lamp by one, so over N ticks every lamp visits
 * every color. Pure + RNG-free → fully testable. Returns one color per lamp,
 * in lamp order.
 */
export function partyColorsAtTick(tick: number, lampCount: number): RgbColor[] {
  const n = PARTY_PALETTE.length;
  return Array.from({ length: lampCount }, (_, i) => PARTY_PALETTE[(((i + tick) % n) + n) % n]);
}
