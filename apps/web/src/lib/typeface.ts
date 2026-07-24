/**
 * Typeface , the board's type PAIR (a sans and its mono), picked in Settings.
 *
 * Deliberately thinner than its sibling lib/accent.ts. The accent module has to
 * carry the hex ramp in TS because maplibre cannot read a CSS var; nothing here
 * has that problem, so the families, weights and tracking all live in
 * styles/tokens.css under `[data-typeface="…"]` and this module only flips the
 * attribute. One place defines what "geist" looks like, and it is the stylesheet.
 *
 * Why a pair and not a font: 43 call sites read `--mono` (every Stat value, the
 * frontend-log counts, the `#sha` chips, the `24H AGO` stamps). Swapping the
 * sans alone would leave Space Mono's typewriter width sitting inside a Geist
 * tile. Each profile therefore names both, and the weights that go with them ,
 * SF and Geist read lighter than Space Grotesk at a matched weight, so their
 * headers step up rather than inheriting a number tuned for a different face.
 *
 * The KEY is wire contract (@cc/api/settings); the labels below are UI copy.
 */

import { TYPEFACES, type Typeface } from "@cc/api/settings";

export { TYPEFACES, type Typeface };

export interface TypefaceOption {
  /** Human label for the settings picker. */
  label: string;
  /** The paired mono, named for the picker's second line. */
  mono: string;
  /** One line on what choosing this costs or buys. */
  note: string;
}

export const TYPEFACE_OPTIONS: Record<Typeface, TypefaceOption> = {
  grotesk: {
    label: "Space Grotesk",
    mono: "Space Mono",
    note: "Self-hosted. Weights 300–700.",
  },
  sf: {
    label: "SF Pro",
    mono: "SF Mono",
    note: "Apple system font. No download, weights 100–900.",
  },
  geist: {
    label: "Geist",
    mono: "Geist Mono",
    note: "Self-hosted. Weights 100–900.",
  },
};

/**
 * Point an element (in practice `document.documentElement`) at a profile.
 *
 * Sets the attribute and nothing else , `[data-typeface="…"]` in tokens.css
 * restates `--ui`, `--mono`, `--w-*` and `--track-*` from there. Every key gets
 * the attribute, `grotesk` included: it is the :root default AND a real block,
 * so writing it explicitly is what lets the Settings picker put the attribute on
 * one option row and have that row render in its own face.
 */
export function applyTypeface(root: HTMLElement, typeface: Typeface): void {
  root.dataset.typeface = typeface;
}
