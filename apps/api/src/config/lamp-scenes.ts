/**
 * Curated lamp scene palette config.
 *
 * Scenes drive `light.turn_on` calls across every lamp (LAMP_ENTITY_IDS):
 *  - white → uniform warm-neutral white via color_temp_kelvin
 *  - red   → uniform pure-red rgb_color
 *  - blue  → uniform pure-blue rgb_color
 *  - mood  → EACH lamp gets a DIFFERENT colour, assigned RANDOMLY from
 *            MOOD_PALETTE on every invocation (no repeats — each lamp is
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

/** Warm-neutral white used by the "white" scene (Hue "concentrate"-ish). */
export const WHITE_SCENE_KELVIN = 2700;

export const RED_RGB: RgbColor = [255, 0, 0];
export const BLUE_RGB: RgbColor = [0, 0, 255];

/**
 * Curated purples/blues/party palette for the "mood" scene. Must hold at least
 * as many DISTINCT colours as there are lamps so every lamp can get a unique
 * one. Colours are assigned randomly per invocation (see assignMoodColors).
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
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick `count` UNIQUE mood colours, randomly assigned. Shuffles the palette and
 * takes the first `count` — so each lamp gets a distinct colour and the mapping
 * is different on every call. `count` must be ≤ MOOD_PALETTE.length (guaranteed
 * by config: the palette holds at least one colour per lamp).
 */
export function assignMoodColors(count: number, rng: () => number = Math.random): RgbColor[] {
  return shuffle(MOOD_PALETTE, rng).slice(0, count);
}
