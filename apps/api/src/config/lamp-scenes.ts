/**
 * Curated lamp scene palette config.
 *
 * Scenes drive `light.turn_on` calls across every lamp (LAMP_ENTITY_IDS):
 *  - white → uniform warm-neutral white via color_temp_kelvin
 *  - red   → uniform pure-red rgb_color
 *  - blue  → uniform pure-blue rgb_color
 *  - mood  → EACH lamp gets a different colour from MOOD_PALETTE (zipped by
 *            index, cycling if there are more lamps than palette entries). The
 *            point of "mood" is a varied purples/blues/party wash, not a flat
 *            colour — so the per-lamp args must differ.
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
 * Curated purples/blues/party palette for the "mood" scene. Zipped to lamps by
 * index (cycling). Order is intentional — adjacent lamps get visibly distinct
 * hues so the room reads as a varied wash rather than a single colour.
 */
export const MOOD_PALETTE: readonly RgbColor[] = [
  [148, 0, 211], // violet
  [75, 0, 130], // indigo
  [0, 90, 255], // electric blue
  [255, 0, 144], // hot pink
  [0, 200, 180], // teal
  [120, 40, 220], // purple
] as const;

/** The colour for `lamp[index]` under the mood scene (cycles the palette). */
export function moodColorForIndex(index: number): RgbColor {
  return MOOD_PALETTE[index % MOOD_PALETTE.length];
}
