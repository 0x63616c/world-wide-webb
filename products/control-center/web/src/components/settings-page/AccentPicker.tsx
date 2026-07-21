/**
 * Accent swatch row , the Settings control that picks the board's one highlight
 * colour.
 *
 * Presentational and controlled (value + onChange), like every other block on a
 * settings page: DisplayPage wires it to the store. A row of round swatches
 * rather than a dropdown because the choice IS the colour , reading the word
 * "Orange" tells you less than seeing it.
 *
 * Real `<input type="radio">`s under visually-hidden styling rather than buttons
 * with `role="radio"`: arrow-key navigation, the single-tab-stop group, and the
 * exclusive selection all come for free from the platform, and there is nothing
 * to keep in sync by hand.
 */

import { ACCENT_PALETTES, ACCENTS, type Accent } from "../../lib/accent";

const SWATCH = 34;

export function AccentPicker({
  value,
  onChange,
}: {
  value: Accent;
  onChange: (accent: Accent) => void;
}) {
  return (
    <fieldset
      style={{ display: "flex", gap: 10, margin: 0, padding: 0, border: "none", minInlineSize: 0 }}
    >
      {/* The group's accessible name. Off-screen rather than hidden , the row of
          colours is self-explanatory on sight and a visible "Accent colour"
          legend would just repeat the setting row's own label. */}
      <legend
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        Accent colour
      </legend>
      {ACCENTS.map((accent) => {
        const palette = ACCENT_PALETTES[accent];
        const selected = accent === value;
        return (
          <label
            key={accent}
            title={palette.label}
            style={{
              width: SWATCH,
              height: SWATCH,
              borderRadius: "50%",
              cursor: "pointer",
              background: palette.acc,
              // The selected swatch gets a ring in its OWN colour, floated off
              // the fill by a tile-coloured gap, so selection reads at a glance
              // without a checkmark competing with the colour itself.
              border: `2px solid ${selected ? "var(--tile)" : "transparent"}`,
              boxShadow: selected ? `0 0 0 2px ${palette.acc}` : "inset 0 0 0 1px var(--hair-2)",
              transition: "box-shadow 0.16s ease",
            }}
          >
            <input
              type="radio"
              name="accent"
              value={accent}
              checked={selected}
              aria-label={palette.label}
              onChange={() => onChange(accent)}
              // Hidden without `display:none` / `visibility:hidden`, either of
              // which would take the input out of the a11y tree along with it.
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                margin: 0,
              }}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
