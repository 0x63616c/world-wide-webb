/**
 * ClimateModalScheduleTimeline , "Comfort Schedule" expanded modal for the Climate tile.
 *
 * WHY this layout: the tile shows ONE instantaneous setpoint. Projection is
 * a dimension it structurally can't express. This modal presents a 24-hour
 * horizontal timeline per zone , a stepped setpoint line the user can scrub ,
 * so the whole day's intent is visible and editable at once.
 *
 * HONEST CAVEAT ON DATA: HA stores no schedule via our client. The day-plan is
 * a pure front-end structure in this POC (the production version would persist
 * via a new backend schedule store). What IS genuinely live:
 *   - zone rows are seeded from ha.getEntities('climate') ambient + current targets
 *   - "Apply now" writes the active-hour segment back through the existing
 *     setClimateTarget / setClimateRange mutations , real HA writes, not fake
 *
 * Layout: stacked zone rows (gap 24). Each row = zone label (left, 10px gap) +
 * a full-width 24-hour track with:
 *   - faint hour gridlines every 2h
 *   - a stepped filled region showing planned setpoint across the day
 *   - draggable segment handles that snap to integer temps within the temp band
 *   - a "now" caret (vertical bar) at the current hour , mirrors AmbientCaret from tile
 * Panel: width 900, maxHeight 720 so the 24h axis is comfortably scrubbable.
 * Spacing: sections gap 24, inner elements gap 10 (Controls modal rhythm).
 *
 * PURE view: all data + callbacks via props. No trpc/hooks.
 */

import { useEffect, useRef, useState } from "react";
import { ClimateHouseSummaryHeader } from "@/components/ClimateHouseSummaryHeader";
import { Stat } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

/** A single segment in the 24-hour plan: startHour 0–23, setpoint in °F. */
interface ScheduleSegment {
  /** Hour this segment starts (0 = midnight, 23 = 11pm). */
  startHour: number;
  /** Planned setpoint for this segment in °F. */
  setpoint: number;
}

/** Per-zone data needed by the timeline. */
export interface ScheduleZone {
  entityId: string;
  /** Display name, e.g. "A/C", "Bedroom". */
  name: string;
  /** Current ambient temperature (°F) from HA current_temperature. */
  ambient: number;
  /** Current committed setpoint from HA , seeds the active segment. */
  currentTarget: number;
  /** HA hvac_action , drives the "now" caret color. */
  action: "cooling" | "heating" | "idle" | "off";
  /** HA min_temp for this entity , lower bound of temp axis. */
  minTemp: number;
  /** HA max_temp for this entity , upper bound of temp axis. */
  maxTemp: number;
  /** The 24-hour day-plan for this zone. Segments must be sorted by startHour.
   *  The plan covers [0, 24): each segment runs from its startHour to the next
   *  segment's startHour (or 24 if it's the last). */
  segments: ScheduleSegment[];
}

export interface ClimateModalScheduleTimelineProps {
  /** All house climate zones from ha.getEntities('climate') (excl. Tesla). */
  zones: ScheduleZone[];
  /**
   * Current hour (0–23) , drives the "now" caret position. Passed as a prop
   * so Storybook stories can freeze time for deterministic rendering.
   */
  nowHour: number;
  /**
   * Called when the user clicks "Apply now" on a zone. The container wires
   * this to setClimateTarget(entityId, setpoint) so the active segment's
   * value is written to the real thermostat immediately.
   */
  onApplyNow: (entityId: string, setpoint: number) => void;
  /**
   * Called when the user drags a segment handle to a new setpoint. The
   * container may persist this to its own schedule store (not HA directly).
   */
  onSetSegment: (entityId: string, startHour: number, setpoint: number) => void;
}

// ─── constants ────────────────────────────────────────────────────────────────

// Displayed temp band for the vertical axis , mirrors the tile's visual band.
// Actual min/max per entity may be wider (HA allows 60-92), but we clamp edits
// within [AXIS_MIN, AXIS_MAX] for a consistent visual scale across zones.
const AXIS_MIN = 65;
const AXIS_MAX = 80;
// Pixel height of each 24h track.
const TRACK_H = 64;
// Pixel width reserved for the zone label column.
const LABEL_W = 80;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Map a setpoint into a y-offset within the track (0 = top = hot, 1 = bottom = cold). */
function yPct(setpoint: number, min: number, max: number): number {
  // Inverted: higher temp = smaller y (toward top of track).
  return 1 - (setpoint - min) / (max - min);
}

/** Find the segment that covers a given hour. */
function segmentAt(segments: ScheduleSegment[], hour: number): ScheduleSegment {
  let active = segments[0];
  for (const seg of segments) {
    if (seg.startHour <= hour) active = seg;
  }
  return active;
}

// ─── HourGridlines ────────────────────────────────────────────────────────────

// Faint vertical lines every 2 hours + hour labels at 0, 6, 12, 18, 24.
function HourGridlines({ trackW }: { trackW: number }) {
  const marks = [0, 6, 12, 18, 24];
  const faint = [2, 4, 8, 10, 14, 16, 20, 22];
  return (
    <svg
      width={trackW}
      height={TRACK_H}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      {/* Faint every-2h lines */}
      {faint.map((h) => (
        <line
          key={h}
          x1={(h / 24) * trackW}
          x2={(h / 24) * trackW}
          y1={0}
          y2={TRACK_H}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={1}
        />
      ))}
      {/* Slightly stronger marks at 0/6/12/18 */}
      {marks.slice(0, -1).map((h) => (
        <line
          key={h}
          x1={(h / 24) * trackW}
          x2={(h / 24) * trackW}
          y1={0}
          y2={TRACK_H}
          stroke="rgba(255,255,255,0.09)"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

// ─── NowCaret ─────────────────────────────────────────────────────────────────

// Vertical "now" marker , mirrors AmbientCaret from ClimateTileView but adapted
// for a horizontal time axis rather than a temperature axis.
function NowCaret({ nowHour, trackW }: { nowHour: number; trackW: number }) {
  const x = (nowHour / 24) * trackW;
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: x,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 2,
          height: "100%",
          background: "rgba(255,255,255,0.5)",
          borderRadius: 1,
        }}
      />
    </div>
  );
}

// ─── SteppedLine ──────────────────────────────────────────────────────────────

// Renders the stepped setpoint plan as an SVG polyline on the track. Each
// segment draws a horizontal line from its startHour to the next, then drops
// vertically to the next segment's setpoint , the "staircase" shape makes it
// clear exactly when the target changes.
function SteppedLine({
  segments,
  trackW,
  minTemp,
  maxTemp,
  active,
}: {
  segments: ScheduleSegment[];
  trackW: number;
  minTemp: number;
  maxTemp: number;
  active: boolean;
}) {
  // Build a polyline path: for each segment, draw a horizontal span then a
  // vertical step at its right boundary (the next segment's startHour).
  const pts: [number, number][] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const nextHour = i + 1 < segments.length ? segments[i + 1].startHour : 24;
    const x1 = (seg.startHour / 24) * trackW;
    const x2 = (nextHour / 24) * trackW;
    const y = yPct(seg.setpoint, minTemp, maxTemp) * TRACK_H;

    if (i === 0) pts.push([x1, y]);
    else pts.push([x1, y]); // vertical step already added by previous iteration end

    pts.push([x2, y]);
    // Vertical step down/up to next segment's level (except after last segment)
    if (i + 1 < segments.length) {
      const nextY = yPct(segments[i + 1].setpoint, minTemp, maxTemp) * TRACK_H;
      pts.push([x2, nextY]);
    }
  }

  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const fillPts = [...pts, [pts[pts.length - 1][0], TRACK_H], [pts[0][0], TRACK_H]];
  const fillD = `${fillPts
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${(x as number).toFixed(1)},${(y as number).toFixed(1)}`,
    )
    .join(" ")} Z`;

  const stroke = active ? "var(--acc)" : "var(--ink-3)";
  const fill = active ? "rgb(var(--acc-rgb) / 0.08)" : "rgba(255,255,255,0.03)";

  return (
    <svg
      width={trackW}
      height={TRACK_H}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden="true"
    >
      <path d={fillD} fill={fill} />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── SegmentHandles ───────────────────────────────────────────────────────────

// Draggable handles at each segment boundary (except the start of the first at 0
// , there's nothing to drag the startHour to). Each handle drags vertically to
// adjust the setpoint of the segment to its left (the one being extended to that
// boundary). Snaps to integer °F. The drag is clamped within minTemp/maxTemp.
function SegmentHandles({
  segments,
  trackW,
  minTemp,
  maxTemp,
  onDrag,
  onCommit,
}: {
  segments: ScheduleSegment[];
  trackW: number;
  minTemp: number;
  maxTemp: number;
  onDrag: (idx: number, setpoint: number) => void;
  onCommit: (idx: number, setpoint: number) => void;
}) {
  const dragging = useRef<{ idx: number; startY: number; startSetpoint: number } | null>(null);
  // Keep latest callbacks in refs so the stable event listeners always call the
  // current version without re-registering on every render.
  const onDragRef = useRef(onDrag);
  const onCommitRef = useRef(onCommit);
  const minTempRef = useRef(minTemp);
  const maxTempRef = useRef(maxTemp);
  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    minTempRef.current = minTemp;
  }, [minTemp]);
  useEffect(() => {
    maxTempRef.current = maxTemp;
  }, [maxTemp]);

  useEffect(() => {
    function toSetpoint(deltaY: number, startSetpoint: number): number {
      const degreesPerPx = (maxTempRef.current - minTempRef.current) / TRACK_H;
      const raw = startSetpoint - deltaY * degreesPerPx;
      return Math.round(Math.min(maxTempRef.current, Math.max(minTempRef.current, raw)));
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const { idx, startY, startSetpoint } = dragging.current;
      onDragRef.current(idx, toSetpoint(e.clientY - startY, startSetpoint));
    }
    function onMouseUp(e: MouseEvent) {
      if (!dragging.current) return;
      const { idx, startY, startSetpoint } = dragging.current;
      onCommitRef.current(idx, toSetpoint(e.clientY - startY, startSetpoint));
      dragging.current = null;
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {segments.map((seg, i) => {
        const x = (seg.startHour / 24) * trackW;
        const y = yPct(seg.setpoint, minTemp, maxTemp) * TRACK_H;
        // Don't render a handle at x=0 , the left edge is the timeline start.
        if (seg.startHour === 0) return null;
        return (
          <div
            key={seg.startHour}
            role="slider"
            aria-label={`${seg.startHour}:00 setpoint`}
            aria-valuenow={seg.setpoint}
            aria-valuemin={minTemp}
            aria-valuemax={maxTemp}
            tabIndex={0}
            style={{
              position: "absolute",
              left: x,
              top: y,
              transform: "translate(-50%, -50%)",
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fff",
              border: "3px solid var(--tile)",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.2), 0 2px 6px -1px rgba(0,0,0,0.6)",
              cursor: "ns-resize",
              pointerEvents: "all",
              zIndex: 2,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              dragging.current = { idx: i, startY: e.clientY, startSetpoint: seg.setpoint };
            }}
          />
        );
      })}
    </div>
  );
}

// ─── ZoneRow ──────────────────────────────────────────────────────────────────

// One row per zone , label left, full-width 24h track right. Drag state lives
// here so rows are independent.
function ZoneRow({
  zone,
  nowHour,
  onSetSegment,
  onApplyNow,
}: {
  zone: ScheduleZone;
  nowHour: number;
  onSetSegment: (entityId: string, startHour: number, setpoint: number) => void;
  onApplyNow: (entityId: string, setpoint: number) => void;
}) {
  // Local copy of segments for drag preview; committed via onSetSegment.
  const [localSegments, setLocalSegments] = useState<ScheduleSegment[]>(zone.segments);

  // Resync when parent updates the zone data (e.g. after a mutation round-trip).
  useEffect(() => {
    setLocalSegments(zone.segments);
  }, [zone.segments]);

  const active = zone.action === "cooling" || zone.action === "heating";
  const activeSegment = segmentAt(localSegments, nowHour);

  function handleDrag(idx: number, setpoint: number) {
    setLocalSegments((prev) => prev.map((s, i) => (i === idx ? { ...s, setpoint } : s)));
  }

  function handleCommit(idx: number, setpoint: number) {
    setLocalSegments((prev) => {
      const next = prev.map((s, i) => (i === idx ? { ...s, setpoint } : s));
      onSetSegment(zone.entityId, next[idx].startHour, setpoint);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Row header: zone name + stats */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: LABEL_W,
              fontSize: 13,
              fontWeight: 600,
              color: active ? "var(--ink)" : "var(--ink-2)",
              letterSpacing: "-0.01em",
              flexShrink: 0,
            }}
          >
            {zone.name}
          </span>
          <div style={{ display: "flex", gap: 16 }}>
            <Stat label="Now" value={`${Math.round(zone.ambient)}°`} muted={!active} />
            <Stat
              label={nowHour < 24 ? `${nowHour}:00 plan` : "Plan"}
              value={`${activeSegment.setpoint}°`}
              accent={active}
            />
          </div>
        </div>
        {/* Apply now , writes the active-hour segment to the real HA thermostat */}
        <button
          type="button"
          onClick={() => onApplyNow(zone.entityId, activeSegment.setpoint)}
          style={{
            height: 28,
            padding: "0 12px",
            borderRadius: 8,
            background: active ? "var(--acc-dim)" : "var(--nest)",
            border: `1px solid ${active ? "var(--acc-line)" : "var(--hair)"}`,
            color: active ? "var(--acc)" : "var(--ink-2)",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Apply now
        </button>
      </div>

      {/* 24h track */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
        {/* Spacer to align track with zone label column */}
        <div style={{ width: LABEL_W, flexShrink: 0 }} />
        {/* Track itself , flex:1 fills remaining width */}
        <div
          style={{
            flex: 1,
            height: TRACK_H,
            position: "relative",
            borderRadius: 10,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            overflow: "hidden",
          }}
        >
          <TrackInner
            zone={zone}
            segments={localSegments}
            nowHour={nowHour}
            active={active}
            onDrag={handleDrag}
            onCommit={handleCommit}
          />
        </div>
      </div>

      {/* Hour labels below track , aligned to track start */}
      <HourLabels labelW={LABEL_W} />
    </div>
  );
}

// ─── TrackInner ───────────────────────────────────────────────────────────────

// Separated so the parent div handles border/radius/overflow while SVG layers
// fill 100% width/height without needing explicit pixel dimensions at render time.
function TrackInner({
  zone,
  segments,
  nowHour,
  active,
  onDrag,
  onCommit,
}: {
  zone: ScheduleZone;
  segments: ScheduleSegment[];
  nowHour: number;
  active: boolean;
  onDrag: (idx: number, setpoint: number) => void;
  onCommit: (idx: number, setpoint: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(600);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setTrackW(w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      <HourGridlines trackW={trackW} />
      <SteppedLine
        segments={segments}
        trackW={trackW}
        minTemp={zone.minTemp}
        maxTemp={zone.maxTemp}
        active={active}
      />
      <NowCaret nowHour={nowHour} trackW={trackW} />
      <SegmentHandles
        segments={segments}
        trackW={trackW}
        minTemp={zone.minTemp}
        maxTemp={zone.maxTemp}
        onDrag={onDrag}
        onCommit={onCommit}
      />
    </div>
  );
}

// ─── HourLabels ───────────────────────────────────────────────────────────────

// X-axis labels: midnight, 6am, noon, 6pm, midnight. Positioned relative to the
// track (after the label column spacer).
function HourLabels({ labelW }: { labelW: number }) {
  const marks = [
    { h: 0, label: "12am" },
    { h: 6, label: "6am" },
    { h: 12, label: "12pm" },
    { h: 18, label: "6pm" },
    { h: 24, label: "12am" },
  ];

  return (
    <div style={{ display: "flex", alignItems: "stretch" }}>
      <div style={{ width: labelW, flexShrink: 0 }} />
      <div style={{ flex: 1, position: "relative", height: 16 }}>
        {marks.map(({ h, label }) => (
          <span
            key={h}
            className="mono"
            style={{
              position: "absolute",
              left: `${(h / 24) * 100}%`,
              transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
              fontSize: 10,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── ClimateModalScheduleTimeline ─────────────────────────────────────────────

export function ClimateModalScheduleTimeline({
  zones,
  nowHour,
  onApplyNow,
  onSetSegment,
}: ClimateModalScheduleTimelineProps) {
  // Whole-house summary: average ambient + active zone count.
  const avgAmbient =
    zones.length > 0 ? Math.round(zones.reduce((s, z) => s + z.ambient, 0) / zones.length) : 0;
  const activeCount = zones.filter((z) => z.action === "cooling" || z.action === "heating").length;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* House summary row , average ambient + how many zones are active right now.
            Mirrors ClimateModalMultiZoneGrid's header banner for visual consistency
            across the two Climate modal concepts. */}
        <ClimateHouseSummaryHeader
          avgAmbientF={avgAmbient}
          anyActive={activeCount > 0}
          secondLabel="Schedule"
          secondValue={
            zones.length === 0
              ? "No zones"
              : `${zones.length} zone${zones.length !== 1 ? "s" : ""} · ${activeCount > 0 ? `${activeCount} active` : "all idle"}`
          }
          right={
            <div
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: "var(--nest)",
                border: "1px solid var(--hair-2)",
                fontSize: 11,
                color: "var(--ink-3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {/* Caret legend , shows which vertical bar is "now" on the timeline */}
              <div
                style={{
                  width: 2,
                  height: 12,
                  background: "rgba(255,255,255,0.5)",
                  borderRadius: 1,
                  flexShrink: 0,
                }}
              />
              <span className="mono">Now · {nowHour}:00</span>
            </div>
          }
        />

        {/* Caveat banner , honest about what persists vs what is live.
            Surface this once so the user understands what "Apply now" does. */}
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(244,192,99,0.06)",
            border: "1px solid rgba(244,192,99,0.2)",
            fontSize: 12,
            color: "var(--amber)",
            lineHeight: 1.5,
          }}
        >
          Day plans are held locally , "Apply now" writes the selected hour's setpoint to the real
          thermostat via HA. Persistent scheduling requires a backend store not yet deployed.
        </div>

        {/* Zone rows , gap 24 between rows for clear visual separation */}
        {zones.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <span className="cap">No climate zones available</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {zones.map((zone) => (
              <ZoneRow
                key={zone.entityId}
                zone={zone}
                nowHour={nowHour}
                onSetSegment={onSetSegment}
                onApplyNow={onApplyNow}
              />
            ))}
          </div>
        )}

        {/* Temp axis legend , explains the vertical handle position mapping */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingTop: 4,
          }}
        >
          <div style={{ width: LABEL_W, flexShrink: 0 }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span className="cap" style={{ color: "var(--ink-3)" }}>
              Handles snap to °F · drag vertically
            </span>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                {AXIS_MIN}° cool
              </span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                {AXIS_MAX}° warm
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
