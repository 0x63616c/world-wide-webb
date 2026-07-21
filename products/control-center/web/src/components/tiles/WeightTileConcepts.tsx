import type { LucideIcon } from "lucide-react";
import { Activity, HeartPulse, Scale, TrendingDown, Weight } from "lucide-react";
import { Icon } from "@/components/Icon";
import { PageHeader, Segmented, Stat, Tile } from "@/components/ui";

/**
 * THROWAWAY CONCEPT , chosen look for the Weight tile (Renpho scale via HA BLE
 * ingest): hero number + baseline sparkline at 3x2, 30-day window and delta.
 * Fixture data only; this gets rebuilt as a real Tile/TileView pair with trpc
 * wiring, then this file is deleted.
 */

// Icon candidates for the header , lucide glyphs not yet in the Icon map. The
// winner gets registered as a proper Icon name in the real tile.
export const ICON_CANDIDATES: { name: string; glyph: LucideIcon }[] = [
  { name: "Weight", glyph: Weight },
  { name: "Scale", glyph: Scale },
  { name: "Activity", glyph: Activity },
  { name: "TrendingDown", glyph: TrendingDown },
  { name: "HeartPulse", glyph: HeartPulse },
];

// ~30 days of plausible daily weigh-ins (lb), newest last. A few gap days
// mirror real life , you skip a day, the line just bridges it.
const FIXTURE: { day: string; lb: number }[] = [
  { day: "Jun 22", lb: 186.2 },
  { day: "Jun 23", lb: 185.8 },
  { day: "Jun 24", lb: 186.0 },
  { day: "Jun 25", lb: 185.4 },
  { day: "Jun 27", lb: 185.1 },
  { day: "Jun 28", lb: 185.5 },
  { day: "Jun 29", lb: 184.8 },
  { day: "Jun 30", lb: 184.4 },
  { day: "Jul 1", lb: 183.9 },
  { day: "Jul 2", lb: 183.2 },
  { day: "Jul 3", lb: 183.6 },
  { day: "Jul 4", lb: 182.8 },
  { day: "Jul 5", lb: 183.0 },
  { day: "Jul 6", lb: 182.1 },
  { day: "Jul 7", lb: 182.5 },
  { day: "Jul 8", lb: 181.9 },
  { day: "Jul 9", lb: 182.3 },
  { day: "Jul 11", lb: 181.4 },
  { day: "Jul 12", lb: 181.7 },
  { day: "Jul 13", lb: 180.8 },
  { day: "Jul 14", lb: 181.2 },
  { day: "Jul 15", lb: 180.6 },
  { day: "Jul 16", lb: 181.0 },
  { day: "Jul 17", lb: 180.3 },
  { day: "Jul 18", lb: 179.9 },
  { day: "Jul 19", lb: 180.6 },
  { day: "Jul 20", lb: 179.7 },
  { day: "Jul 21", lb: 180.1 },
];

const latest = FIXTURE[FIXTURE.length - 1];
// 30-day delta: latest vs the first point of the window.
const delta30 = latest.lb - FIXTURE[0].lb;

// Map the series onto an SVG viewBox. Padding keeps the 2px stroke and the
// latest-point dot inside the box; y is inverted (SVG grows downward).
function linePoints(w: number, h: number, pad = 6): { x: number; y: number }[] {
  const lbs = FIXTURE.map((d) => d.lb);
  const min = Math.min(...lbs);
  const max = Math.max(...lbs);
  return FIXTURE.map((d, i) => ({
    x: pad + (i / (FIXTURE.length - 1)) * (w - 2 * pad),
    y: pad + ((max - d.lb) / (max - min || 1)) * (h - 2 * pad),
  }));
}

function pathFrom(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function DeltaBadge({ delta }: { delta: number }) {
  const down = delta < 0;
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 12,
        fontWeight: 700,
        color: down ? "var(--acc)" : "var(--ink-2)",
      }}
    >
      <Icon name={down ? "down" : "up"} s={13} />
      {Math.abs(delta).toFixed(1)} lb / 30d
    </span>
  );
}

/** Hero + sparkline 3x2 with a swappable header glyph (icon bake-off). */
export function WeightConceptSparkline({ glyph: Glyph = Weight }: { glyph?: LucideIcon }) {
  const W = 260;
  const H = 56;
  const pts = linePoints(W, H);
  const last = pts[pts.length - 1];
  return (
    <Tile padding={20} style={{ position: "relative" }}>
      {/* Inline TileHeader clone so the concept can take a raw lucide glyph */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Glyph size={19} color="var(--ink-2)" strokeWidth={1.7} style={{ display: "block" }} />
        <span style={{ fontSize: 17.5, fontWeight: 600, letterSpacing: "-0.015em" }}>Weight</span>
        <div style={{ marginLeft: "auto" }}>
          <DeltaBadge delta={delta30} />
        </div>
      </div>
      {/* Sparkline on top, hero number + date at the bottom */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div style={{ position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: H, display: "block" }}
            aria-hidden="true"
          >
            <path
              d={pathFrom(pts)}
              fill="none"
              stroke="var(--acc)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
          {/* Latest-point dot drawn outside the stretched svg so it stays round */}
          <span
            style={{
              position: "absolute",
              right: 4,
              bottom: H - (last.y / H) * H - 4,
              width: 8,
              height: 8,
              borderRadius: 4,
              background: "var(--acc)",
            }}
          />
        </div>
        {/* lineHeight 1 , the 40px mono's default leading otherwise pads the
            bottom edge unevenly vs the 20px tile padding at the top */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, lineHeight: 1 }}>
          <span
            className="mono"
            style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {latest.lb.toFixed(1)}
          </span>
          <span style={{ fontSize: 14, color: "var(--ink-2)" }}>lb</span>
          {/* Real tile renders "Today"/"Yesterday" for the two most recent days,
              falling back to the short date ("Jul 12") beyond that. Fixture's
              latest is today, so the concept hardcodes the label. */}
          <span
            style={{ fontSize: 12, color: "var(--ink-2)", marginLeft: "auto" }}
            className="mono"
          >
            Today
          </span>
        </div>
      </div>
    </Tile>
  );
}

/**
 * Detail page concept , the FULL-SCREEN page that opens on tile tap (pages over
 * modals for new tiles). Minimal: header with hero number, a 7d/30d/All range
 * picker, a restrained chart, and a small stats row (low/high/avg/change) for
 * the selected window.
 */
export function WeightConceptDetail({ onBack = () => {} }: { onBack?: () => void }) {
  const W = 1120;
  const H = 380;
  const PAD = 16;
  const pts = linePoints(W, H, PAD);
  const lbs = FIXTURE.map((d) => d.lb);
  const min = Math.min(...lbs);
  const max = Math.max(...lbs);
  const avg = lbs.reduce((a, b) => a + b, 0) / lbs.length;
  const iMin = lbs.indexOf(min);
  const iMax = lbs.indexOf(max);
  const last = pts[pts.length - 1];
  return (
    <div
      style={{
        width: 1366,
        height: 1024,
        background: "var(--bg, #16171b)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PageHeader
        title="Weight"
        onBack={onBack}
        right={
          <span
            className="mono"
            style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}
          >
            {latest.lb.toFixed(1)}
            <span style={{ fontSize: 15, fontWeight: 400, color: "var(--ink-2)" }}> lb</span>
          </span>
        }
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: "16px 96px 72px",
        }}
      >
        {/* Range picker , centered; concept shows 30d selected, taps wired in the real page */}
        <div style={{ width: 360, alignSelf: "center" }}>
          <Segmented
            label="Range"
            options={[
              { value: "7d", label: "7d" },
              { value: "30d", label: "30d" },
              { value: "all", label: "All time" },
            ]}
            value="30d"
            onChange={() => {}}
          />
        </div>
        {/* Chart fills the space between picker and stats */}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", display: "block" }}
            aria-hidden="true"
          >
            <line
              x1={PAD}
              x2={W - PAD}
              y1={pts[iMax].y}
              y2={pts[iMax].y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <line
              x1={PAD}
              x2={W - PAD}
              y1={pts[iMin].y}
              y2={pts[iMin].y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <path
              d={pathFrom(pts)}
              fill="none"
              stroke="var(--acc)"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </svg>
          {/* Round latest-point dot , outside the stretched svg */}
          <span
            style={{
              position: "absolute",
              left: `${(last.x / W) * 100}%`,
              top: `${(last.y / H) * 100}%`,
              width: 9,
              height: 9,
              borderRadius: 5,
              background: "var(--acc)",
              transform: "translate(-50%, -50%)",
            }}
          />
          <span
            className="mono"
            style={{
              position: "absolute",
              left: 0,
              top: `calc(${(pts[iMax].y / H) * 100}% - 20px)`,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {max.toFixed(1)}
          </span>
          <span
            className="mono"
            style={{
              position: "absolute",
              left: 0,
              top: `calc(${(pts[iMin].y / H) * 100}% + 8px)`,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {min.toFixed(1)}
          </span>
          <span
            className="mono"
            style={{
              position: "absolute",
              right: 0,
              bottom: -18,
              fontSize: 12,
              color: "var(--ink-2)",
            }}
          >
            {FIXTURE[0].day} – Today
          </span>
        </div>
        {/* Stats for the selected window , pinned under the chart */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            marginTop: 8,
            flexShrink: 0,
          }}
        >
          <Stat label="Low" value={`${min.toFixed(1)} lb`} />
          <Stat label="High" value={`${max.toFixed(1)} lb`} />
          <Stat label="Average" value={`${avg.toFixed(1)} lb`} />
          <Stat label="Change" value={`${delta30 > 0 ? "+" : ""}${delta30.toFixed(1)} lb`} accent />
        </div>
      </div>
    </div>
  );
}
