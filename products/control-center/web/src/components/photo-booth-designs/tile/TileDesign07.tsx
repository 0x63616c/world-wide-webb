import { Icon } from "@/components/Icon";
import { Tile } from "@/components/ui";

/**
 * Design 07 , "Tally" (2x3, tall).
 * Count-forward: a big mono number is the hero, with a 2x2 contact-sheet of
 * decorative gradient thumbs beneath. The number is a sample figure for the
 * design mock, not live data. Vertical, narrow footprint.
 */
const THUMBS = [
  "linear-gradient(140deg,#ff9d6c,#bb4e75)",
  "linear-gradient(140deg,#3a7bd5,#00d2c6)",
  "linear-gradient(140deg,#b06ab3,#4568dc)",
  "linear-gradient(140deg,#f6d365,#fda085)",
];

export function TileDesign07() {
  return (
    <Tile padding={18}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name="cam" s={16} c="var(--ink-2)" />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>Photo booth</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
        <span
          className="mono"
          style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, color: "var(--ink)" }}
        >
          247
        </span>
        <span className="cap" style={{ marginTop: 6 }}>
          photos taken
        </span>
      </div>
      <div
        style={{
          marginTop: "auto",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
        }}
      >
        {THUMBS.map((g) => (
          <div key={g} style={{ paddingTop: "100%", borderRadius: 8, background: g }} />
        ))}
      </div>
      <div className="cap acc" style={{ marginTop: 12 }}>
        tap to snap
      </div>
    </Tile>
  );
}
