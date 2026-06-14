/**
 * EventsModalTimelineGaps , "Runway Timeline" expanded view for the Events tile.
 *
 * WHY this layout:
 * The tile truncates to 3 events and shows only the raw day counts. That hides
 * the relationship BETWEEN events: three events at days 1/2/3 looks identical
 * to 3/40/80 in a flat list. This modal maps the schedule onto a proportional
 * vertical axis so clustering and dead stretches are immediately legible. The
 * spine spacing itself encodes schedule density , a new analytic dimension
 * from data we already have, no router changes needed.
 *
 * Layout: a single vertical spine with nodes plotted at positions proportional
 * to their day offset from now. A "now" marker sits at the top. Gap labels
 * ("+37d") appear between nodes that are more than 14 days apart, turning the
 * empty rail into an explicit readout of upcoming dead time.
 *
 * PURE view: all data + callbacks via props. No trpc/hooks. Composes directly
 * in Storybook and tests without any query setup.
 */

import type { EventRow } from "@/components/tiles/EventsTileView";
import { Modal } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface EventsModalTimelineGapsProps {
  open: boolean;
  onClose: () => void;
  events: EventRow[];
}

// ─── constants ────────────────────────────────────────────────────────────────

// Minimum pixel gap between nodes so adjacent events never visually merge,
// even when their day offsets are close (e.g. days 0 and 1).
const MIN_NODE_GAP_PX = 56;

// Gap label shown between consecutive nodes that are more than this many days
// apart , makes large dead stretches explicit rather than just tall whitespace.
const GAP_LABEL_THRESHOLD_DAYS = 14;

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Map sorted event days onto pixel Y positions along the spine.
 * The total canvas height is determined by the sum of proportional gaps,
 * clamped so the timeline is never shorter than MIN_NODE_GAP_PX × eventCount.
 */
function computePositions(events: EventRow[]): number[] {
  if (events.length === 0) return [];
  if (events.length === 1) return [0];

  const maxDay = events[events.length - 1].days;
  // Total canvas height , at least MIN_NODE_GAP_PX per gap, scaled up when
  // the day spread is large so proportionality is still visible.
  const minTotal = MIN_NODE_GAP_PX * (events.length - 1);
  const scaledTotal = maxDay > 0 ? Math.max(minTotal, maxDay * 5) : minTotal;

  return events.map((e) => (maxDay > 0 ? (e.days / maxDay) * scaledTotal : 0));
}

// ─── sub-components ───────────────────────────────────────────────────────────

function NowMarker() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 8,
      }}
    >
      {/* Pulsing accent dot , the "you are here" marker at the top of the spine */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "var(--acc)",
          boxShadow: "0 0 0 3px var(--acc-dim)",
          flexShrink: 0,
        }}
      />
      <span className="cap" style={{ color: "var(--acc)", fontSize: 10 }}>
        Now
      </span>
    </div>
  );
}

interface GapLabelProps {
  days: number;
}

function GapLabel({ days }: GapLabelProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingLeft: 3,
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: "0.04em",
        }}
      >
        +{days}d
      </span>
      {/* Faint dashed stretch to make the gap visible on the spine */}
      <div
        style={{
          flex: 1,
          borderBottom: "1px dashed var(--hair-2)",
          marginRight: 24,
          opacity: 0.5,
        }}
      />
    </div>
  );
}

interface TimelineNodeProps {
  event: EventRow;
  nearest: boolean;
}

function TimelineNode({ event, nearest }: TimelineNodeProps) {
  const accent = nearest || event.days <= 3;
  const nodeColor = accent ? "var(--acc)" : "var(--ink-2)";
  const borderColor = accent ? "var(--acc-line)" : "var(--hair-2)";
  const bgColor = accent ? "var(--acc-dim)" : "var(--nest)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      }}
    >
      {/* Spine dot , larger than the now marker to read as a destination node */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
          paddingTop: 4,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            border: `2px solid ${borderColor}`,
            background: bgColor,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Event card , day count prominently left, name + place right */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          paddingBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
          <span
            className="mono"
            style={{
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 1,
              color: nodeColor,
            }}
          >
            {event.days}
          </span>
          <span className="cap" style={{ fontSize: 10, color: "var(--ink-3)" }}>
            days
          </span>
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: 2,
          }}
        >
          {event.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {event.place}
        </div>
      </div>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function EventsModalTimelineGaps({ open, onClose, events }: EventsModalTimelineGapsProps) {
  const sorted = [...events].sort((a, b) => a.days - b.days);
  const positions = computePositions(sorted);
  const totalHeight = positions.length > 0 ? positions[positions.length - 1] : 0;

  return (
    <Modal open={open} onClose={onClose} title="Events" width={560} maxHeight={760}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Section label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span className="cap">Runway Timeline</span>
          {sorted.length > 0 && (
            <span className="cap" style={{ color: "var(--ink-3)" }}>
              {sorted.length} event{sorted.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Empty state */}
        {sorted.length === 0 && (
          <div
            style={{
              padding: "48px 0",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 14,
            }}
          >
            No upcoming events
          </div>
        )}

        {/* Timeline */}
        {sorted.length > 0 && (
          <div style={{ display: "flex", gap: 0 }}>
            {/* Left column: spine line */}
            <div
              style={{
                width: 1,
                background: "var(--hair)",
                marginLeft: 4,
                marginRight: 20,
                flexShrink: 0,
                // The spine starts just below the now-marker dot and runs to
                // just above the last node, so it visually connects all dots.
                marginTop: 10,
                height: totalHeight + 24 * (sorted.length - 1) + 24,
              }}
            />

            {/* Right column: now marker + nodes with proportional spacing */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <NowMarker />

              {sorted.map((event, idx) => {
                const gapFromPrev = idx === 0 ? event.days : event.days - sorted[idx - 1].days;
                const showGapLabel = gapFromPrev > GAP_LABEL_THRESHOLD_DAYS;

                // Proportional spacing via top padding derived from position delta.
                // For the first node, use the position directly; for subsequent
                // nodes, derive the increment from consecutive positions.
                const spacingPx =
                  idx === 0
                    ? Math.max(MIN_NODE_GAP_PX, positions[0])
                    : Math.max(MIN_NODE_GAP_PX, positions[idx] - positions[idx - 1]);

                return (
                  <div
                    key={`${event.name}-${event.place}-${event.days}`}
                    style={{ paddingTop: spacingPx - MIN_NODE_GAP_PX + 16 }}
                  >
                    {showGapLabel && <GapLabel days={gapFromPrev} />}
                    <TimelineNode event={event} nearest={idx === 0} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
