/**
 * Accent palette , the one highlight colour the whole board is built around.
 *
 * The panel has exactly one accent. Every `--acc*` token in styles/tokens.css
 * derives from it, so switching accents is a matter of restating two hexes and
 * one rgb triple on `:root`; the dim/line/glow tints recompute from
 * `--acc-rgb` on their own.
 *
 * Two consumers, two shapes:
 *   - CSS (nearly everything) reads the vars this module writes onto :root.
 *   - maplibre (the Tesla range circles, the location marker HTML) cannot read
 *     CSS vars , its paint properties want a literal colour string. Those read
 *     `accentPalette()` / `useAccent()` instead, off the SAME table, so the map
 *     can never drift from the board.
 *
 * The accent KEY is wire contract (@cc/api/settings); the hexes below are a
 * rendering concern and deliberately live here rather than in the API.
 */

import { ACCENTS, type Accent } from "@cc/api/settings";
import { useSettings } from "./settings";

export { ACCENTS, type Accent };

export interface AccentPalette {
  /** The accent itself , `--acc`. */
  acc: string;
  /** One step darker, for pressed states and gradient tails , `--acc-2`. */
  acc2: string;
  /** Space-separated sRGB channels of `acc`, for `rgb(var(--acc-rgb) / α)`. */
  rgb: string;
  /** Human label for the settings picker. */
  label: string;
}

/**
 * The four accents. `white` is a near-white rather than #ffffff , pure white on
 * a #000 board reads as a blown-out highlight next to --ink (#ededed), and the
 * dim/line tints derived from it need somewhere to sit below the foreground.
 */
export const ACCENT_PALETTES: Record<Accent, AccentPalette> = {
  blue: { acc: "#0070f3", acc2: "#0061d5", rgb: "0 112 243", label: "Blue" },
  white: { acc: "#ededed", acc2: "#b4b4b4", rgb: "237 237 237", label: "White" },
  green: { acc: "#0ac57f", acc2: "#08a267", rgb: "10 197 127", label: "Green" },
  orange: { acc: "#ff7a1a", acc2: "#e0620a", rgb: "255 122 26", label: "Orange" },
};

/** The palette for an accent key, falling back to blue for an unknown value. */
export function accentPalette(accent: Accent): AccentPalette {
  return ACCENT_PALETTES[accent] ?? ACCENT_PALETTES.blue;
}

/**
 * Write an accent's vars onto an element (in practice `document.documentElement`).
 *
 * Only the three PRIMITIVES are set. `--acc-dim`, `--acc-line` and `--acc-glow`
 * are declared in tokens.css in terms of `--acc-rgb`, so they follow without
 * being restated here , one place to change a tint, not five.
 */
export function applyAccent(root: HTMLElement, accent: Accent): void {
  const { acc, acc2, rgb } = accentPalette(accent);
  root.style.setProperty("--acc", acc);
  root.style.setProperty("--acc-2", acc2);
  root.style.setProperty("--acc-rgb", rgb);
  // Lets CSS (and screenshots) see which accent is live without parsing hexes.
  root.dataset.accent = accent;
}

/** The live accent palette, re-rendering when the setting changes. */
export function useAccent(): AccentPalette {
  return accentPalette(useSettings().accent);
}
