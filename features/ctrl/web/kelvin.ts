/**
 * Approximate sRGB of a black-body color temperature, for the White scene's
 * swatch so it visibly warms/cools with the slider. Tanner Helland's fit
 * (1000..40000K), good to a few percent; this is a preview tint, not a
 * colorimetric conversion.
 */

const WHITE_KELVIN_MIN_LIMIT = 1000;
const WHITE_KELVIN_MAX_LIMIT = 40000;

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(channel: number): string {
  return clamp255(channel).toString(16).padStart(2, "0");
}

export function kelvinToHex(kelvin: number): string {
  const t = Math.max(WHITE_KELVIN_MIN_LIMIT, Math.min(WHITE_KELVIN_MAX_LIMIT, kelvin)) / 100;

  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

/**
 * The White scene swatch for a temperature: kelvinToHex blended halfway to
 * white. The raw black-body fit for 2700K is a saturated orange, but a 2700K
 * bulb READS as a warm cream, and the swatch should look like the lamp, not
 * the physics. 6500K stays near-white either way.
 */
export function whiteSwatchHex(kelvin: number): string {
  const v = Number.parseInt(kelvinToHex(kelvin).slice(1), 16);
  const mix = (c: number) => toHex(c + (255 - c) * 0.5);
  return `#${mix((v >> 16) & 255)}${mix((v >> 8) & 255)}${mix(v & 255)}`;
}
