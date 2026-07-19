import { Icon } from "@/components/Icon";
import { Tile, TileHeader } from "@/components/ui";
import { toggleDogModePreview, useDogModePreview } from "../../lib/dogmode-preview-store";

/**
 * Dog Mode , a one-tap "home alone with the dog" comfort routine (climate hold,
 * calming audio, cam on). PLACEHOLDER tile , the routine is not wired to the
 * house yet, so the arm button toggles a local preview only and the tile is
 * clearly flagged "Coming soon". No live status is fabricated.
 */

// What Dog Mode will do once it is connected. Shown as an inert preview list so
// the tile reads as a real feature-in-progress rather than empty chrome.
const ROUTINE = ["Hold climate at 21°C", "Calming playlist on speakers", "Dog Cam recording on"];

interface DogModeTileViewProps {
  armed: boolean;
  onToggle: () => void;
}

export function DogModeTileView({ armed, onToggle }: DogModeTileViewProps) {
  return (
    <Tile padding={22}>
      <TileHeader
        icon="paw"
        title="Dog Mode"
        right={
          <span className="cap" style={{ color: "var(--ink-3)" }}>
            Coming soon
          </span>
        }
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            display: "grid",
            placeItems: "center",
            background: "var(--tile-2)",
            border: "1px solid var(--hair)",
            color: armed ? "var(--acc)" : "var(--ink-2)",
          }}
        >
          <Icon name="paw" s={22} c="currentColor" />
        </div>
        <span style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>
          {armed ? "Preview , Dog Mode armed" : "Keep the pups comfy when you're out"}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          justifyContent: "center",
        }}
      >
        {ROUTINE.map((item) => (
          <div
            key={item}
            style={{ display: "flex", alignItems: "center", gap: 10, opacity: armed ? 1 : 0.5 }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: armed ? "var(--acc)" : "var(--ink-3)",
                flex: "0 0 auto",
              }}
            />
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{item}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className={`chip${armed ? " on" : ""}`}
        onClick={onToggle}
        style={{ marginTop: "auto", padding: "11px 0", width: "100%" }}
      >
        {armed ? "Disarm (preview)" : "Arm Dog Mode (preview)"}
      </button>

      <div
        className="cap"
        style={{
          marginTop: 8,
          textTransform: "none",
          letterSpacing: 0,
          fontSize: 11,
          color: "var(--ink-3)",
          textAlign: "center",
        }}
      >
        Preview only , not yet connected to the house
      </div>
    </Tile>
  );
}

export function DogModeTile() {
  // Shared preview flag (dogmode-preview-store): the full-page detail shows the
  // same card, so arming there arms the face too , one preview, not two.
  const armed = useDogModePreview();
  return <DogModeTileView armed={armed} onToggle={toggleDogModePreview} />;
}
