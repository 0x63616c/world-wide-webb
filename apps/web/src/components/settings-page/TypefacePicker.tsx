/**
 * Typeface picker , the Settings control that chooses the board's type pair.
 *
 * A stacked list rather than AccentPicker's swatch row: a colour is legible as a
 * 34px dot, a typeface is not. Each row carries `data-typeface`, so the CSS
 * profile blocks in tokens.css style it in its OWN pair , the sample line is
 * literally the face you are choosing, rendered by the same rules the board
 * will use, weights and tracking included. Nothing here restates a family.
 *
 * Real `<input type="radio">`s under visually-hidden styling, for the same
 * reasons as AccentPicker: arrow-key navigation, one tab stop for the group and
 * exclusive selection all come from the platform.
 */

import { TYPEFACE_OPTIONS, TYPEFACES, type Typeface } from "../../lib/typeface";

export function TypefacePicker({
  value,
  onChange,
}: {
  value: Typeface;
  onChange: (typeface: Typeface) => void;
}) {
  return (
    <fieldset
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: 0,
        padding: 0,
        border: "none",
        minInlineSize: 0,
        width: "100%",
      }}
    >
      <legend
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        Typeface
      </legend>
      {TYPEFACES.map((typeface) => {
        const option = TYPEFACE_OPTIONS[typeface];
        const selected = typeface === value;
        return (
          <label
            key={typeface}
            data-typeface={typeface}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: "pointer",
              padding: "12px 14px",
              borderRadius: 14,
              background: selected ? "var(--acc-dim)" : "var(--nest)",
              border: `1px solid ${selected ? "var(--acc-line)" : "var(--hair)"}`,
              transition: "background 0.16s ease, border-color 0.16s ease",
              // The row renders in the face it offers , the tokens come from the
              // `data-typeface` above, so this is the real pair, not a mockup.
              fontFamily: "var(--ui)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 17,
                  fontWeight: "var(--w-title)",
                  letterSpacing: "var(--track-title)",
                }}
              >
                {option.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                }}
              >
                {option.mono} · 0123 #a1b2c3
              </span>
            </div>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 11.5,
                color: "var(--ink-3)",
                textAlign: "right",
                maxWidth: 190,
              }}
            >
              {option.note}
            </span>
            <input
              type="radio"
              name="typeface"
              value={typeface}
              checked={selected}
              aria-label={`${option.label} with ${option.mono}`}
              onChange={() => onChange(typeface)}
              // Hidden without `display:none` / `visibility:hidden`, either of
              // which would take the input out of the a11y tree along with it.
              style={{ position: "absolute", width: 1, height: 1, opacity: 0, margin: 0 }}
            />
          </label>
        );
      })}
    </fieldset>
  );
}
