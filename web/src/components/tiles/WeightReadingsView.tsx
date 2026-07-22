import { Skeleton, TileStatus } from "@/components/ui";

/**
 * WeightReadingsView — presentational Readings variant of the weight detail
 * page (spec 2026-07-21-weight-tile-design): every raw measurement newest-
 * first, excluded rows dimmed + struck through with an AUTO-FLAGGED chip when
 * the sanity band did it, and an Include/Exclude toggle per row. Date shows
 * only on the first row of each day; same-day repeats are time-only. Ported
 * from the approved WeightConceptReadings concept (host owns the header).
 */

export interface WeightReadingRow {
  id: string;
  /** "Today · 7:12 AM" on a day's first row; "7:41 AM" on same-day repeats. */
  whenLabel: string;
  /** True on the first row of each day (grouping cue only — label is prebuilt). */
  showDate: boolean;
  lb: number;
  /** vs previous included reading; null for excluded rows and the very first. */
  deltaLb: number | null;
  excluded: boolean;
  /** True when the exclusion came from the sanity band, not a manual toggle. */
  auto: boolean;
}

export interface WeightReadingsViewProps {
  status: TileStatus;
  readings?: WeightReadingRow[];
  onToggle: (id: string, excluded: boolean) => void;
}

function ListSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Skeleton w="100%" h={64} borderRadius={14} />
      <Skeleton w="100%" h={64} borderRadius={14} />
      <Skeleton w="100%" h={64} borderRadius={14} />
      <Skeleton w="100%" h={64} borderRadius={14} />
    </div>
  );
}

export function WeightReadingsView({ status, readings, onToggle }: WeightReadingsViewProps) {
  if (status !== TileStatus.Populated || readings == null) return <ListSkeleton />;

  if (readings.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontSize: 14, color: "var(--ink-3)" }}>
          No weigh-ins yet — step on the scale.
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 920,
        margin: "0 auto",
      }}
    >
      {readings.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "18px 24px",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 14,
            opacity: r.excluded ? 0.55 : 1,
            // Slight extra air before each new day's first row.
            marginTop: r.showDate ? 4 : 0,
          }}
        >
          <span className="mono" style={{ fontSize: 14, color: "var(--ink-2)", width: 220 }}>
            {r.whenLabel}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 22,
              fontWeight: 700,
              textDecoration: r.excluded ? "line-through" : "none",
            }}
          >
            {r.lb.toFixed(1)}{" "}
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--ink-2)" }}>lb</span>
          </span>
          {r.deltaLb != null && (
            <span
              className="mono"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: r.deltaLb < 0 ? "var(--acc)" : "var(--ink-2)",
              }}
            >
              {r.deltaLb > 0 ? "+" : ""}
              {r.deltaLb.toFixed(1)}
            </span>
          )}
          {r.excluded && r.auto && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--ink-2)",
                border: "1px solid var(--hair)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              AUTO-FLAGGED
            </span>
          )}
          <button
            type="button"
            onClick={() => onToggle(r.id, !r.excluded)}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              color: r.excluded ? "var(--acc)" : "var(--ink-2)",
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            {r.excluded ? "Include" : "Exclude"}
          </button>
        </div>
      ))}
    </div>
  );
}
