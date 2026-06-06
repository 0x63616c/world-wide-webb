/**
 * ClockModalCountdownHorizon — "Countdown Horizon" detail modal for the Clock tile.
 *
 * WHY this layout: the clock tells you what time it is right now, but nothing about
 * what's coming. This modal bridges that gap by taking the events list and presenting
 * them as a shared temporal horizon: every event is plotted on the same scale bar so
 * relative proximity is instantly readable — the nearest event anchors the left edge,
 * the furthest stretches right, and today events glow green. A big monospace day count
 * left of each row lets urgency be absorbed in a glance before reading the name.
 *
 * Layout:
 *   Header strip  — today's full date + "next event in X days" summary pill
 *   Timeline ruler — shared horizontal scale bar (0 → max days) with tick marks
 *   Event rows     — days gutter (left) · name/place (mid) · position dot on ruler
 *   gap 24 between header and list sections, gap 13 between rows.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Width 640, maxHeight 700.
 */

import { Modal } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface CountdownEvent {
  name: string;
  place: string;
  /** Whole days until the event. 0 = today. */
  days: number;
}

export interface ClockModalCountdownHorizonProps {
  open: boolean;
  onClose: () => void;
  /** Today's full date string — e.g. "Saturday, May 31, 2026". */
  todayLabel: string;
  /** Upcoming events ordered by date (days ascending). */
  events: CountdownEvent[];
}

// ─── constants ────────────────────────────────────────────────────────────────

// Ruler tick positions as fractions 0..1 — always drawn regardless of event count
// so the scale reads even with sparse data.
const RULER_TICKS = [0, 0.25, 0.5, 0.75, 1];

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Map a day count onto 0..1 within the horizon window. */
function toFraction(days: number, maxDays: number): number {
  if (maxDays === 0) return 0;
  return Math.min(days / maxDays, 1);
}

/** Human-readable label for a days value. */
function daysLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** Horizontal ruler with evenly spaced tick lines and day labels at each end. */
function HorizonRuler({ maxDays }: { maxDays: number }) {
  return (
    <div
      style={{
        position: "relative",
        height: 28,
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* Base track */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          height: 2,
          borderRadius: 999,
          background: "var(--hair-2)",
        }}
      />
      {/* Tick marks at 0 / 25% / 50% / 75% / 100% */}
      {RULER_TICKS.map((frac) => (
        <div
          key={frac}
          style={{
            position: "absolute",
            left: `${frac * 100}%`,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 3,
          }}
        >
          <div
            style={{
              width: 1,
              height: 8,
              background: "var(--hair-2)",
              borderRadius: 1,
            }}
          />
          <span
            className="mono"
            style={{ fontSize: 9, color: "var(--ink-3)", whiteSpace: "nowrap" }}
          >
            {frac === 0 ? "now" : `${Math.round(frac * maxDays)}d`}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Single event row: big day count left, name+place centre, dot on shared ruler. */
function EventRow({
  event,
  maxDays,
  isToday,
}: {
  event: CountdownEvent;
  maxDays: number;
  isToday: boolean;
}) {
  const frac = toFraction(event.days, maxDays);
  const accentColor = isToday ? "var(--acc)" : "var(--ink-2)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "14px 0",
        borderBottom: "1px solid var(--hair)",
      }}
    >
      {/* Top row: day count gutter + name/place */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Big day count — instant urgency read */}
        <div
          style={{
            minWidth: 56,
            textAlign: "right",
            flexShrink: 0,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: isToday ? 28 : 32,
              fontWeight: 600,
              color: isToday ? "var(--acc)" : "var(--ink)",
              lineHeight: 1,
            }}
          >
            {isToday ? "0" : String(event.days)}
          </span>
          {/* "days" unit label below the number */}
          <div>
            <span
              className="cap"
              style={{ fontSize: 9, color: accentColor, letterSpacing: "0.14em" }}
            >
              {isToday ? "today" : "days"}
            </span>
          </div>
        </div>

        {/* Vertical divider */}
        <div
          style={{
            width: 1,
            height: 40,
            background: isToday ? "var(--acc-line)" : "var(--hair)",
            flexShrink: 0,
          }}
        />

        {/* Name + place */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {event.place}
          </div>
        </div>

        {/* Days-away badge */}
        <span
          className="pill"
          style={
            isToday
              ? {
                  background: "var(--acc-dim)",
                  borderColor: "var(--acc-line)",
                  color: "var(--acc)",
                  fontSize: 11.5,
                }
              : { fontSize: 11.5 }
          }
        >
          {daysLabel(event.days)}
        </span>
      </div>

      {/* Position dot on the shared timeline ruler */}
      <div style={{ position: "relative", height: 10 }}>
        {/* Dim track filling left of the event position — shows how far the event
            is through the horizon at a glance, like a progress bar. */}
        <div
          style={{
            position: "absolute",
            left: 72, // aligns with ruler start (after gutter + divider)
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: 2,
            borderRadius: 999,
            background: "var(--hair)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 72,
            width: `calc((100% - 72px) * ${frac})`,
            top: "50%",
            transform: "translateY(-50%)",
            height: 2,
            borderRadius: 999,
            background: isToday ? "var(--acc-line)" : "var(--hair-2)",
          }}
        />
        {/* Position dot on the ruler track */}
        <div
          style={{
            position: "absolute",
            left: `calc(72px + (100% - 72px) * ${frac} - 5px)`,
            top: "50%",
            transform: "translateY(-50%)",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: isToday ? "var(--acc)" : "var(--ink-2)",
            boxShadow: isToday ? "0 0 8px var(--acc-line)" : undefined,
            flexShrink: 0,
          }}
        />
      </div>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockModalCountdownHorizon({
  open,
  onClose,
  todayLabel,
  events,
}: ClockModalCountdownHorizonProps) {
  // The horizon spans from today (0) to the furthest event. All bars are scaled
  // relative to this maximum so the nearest event reads as "just ahead" and the
  // furthest reads at the right edge of the ruler.
  const maxDays = events.length > 0 ? Math.max(...events.map((e) => e.days)) : 30;
  const nextEvent = events.find((e) => e.days > 0) ?? events[0];
  const nextInDays = nextEvent?.days ?? null;

  return (
    <Modal open={open} onClose={onClose} title="Clock" width={640} maxHeight={700}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Header strip ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 13,
          }}
        >
          <div>
            {/* Today's date in full — grounding the modal in the present moment */}
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)", lineHeight: 1.2 }}>
              {todayLabel}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
              Upcoming events horizon
            </div>
          </div>

          {/* Summary pill: how far away the next event is */}
          {nextInDays !== null && (
            <span
              className="pill"
              style={
                nextInDays === 0
                  ? {
                      background: "var(--acc-dim)",
                      borderColor: "var(--acc-line)",
                      color: "var(--acc)",
                      fontSize: 12.5,
                      whiteSpace: "nowrap",
                    }
                  : { fontSize: 12.5, whiteSpace: "nowrap" }
              }
            >
              {nextInDays === 0
                ? "Event today"
                : nextInDays === 1
                  ? "Next event tomorrow"
                  : `Next event in ${nextInDays} days`}
            </span>
          )}
        </div>

        {events.length === 0 ? (
          // Empty state — no events in the DB yet.
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "48px 0",
              gap: 10,
            }}
          >
            <span className="cap" style={{ letterSpacing: "0.12em", textAlign: "center" }}>
              No upcoming events
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center" }}>
              Add events to see them on the horizon
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {/* ── Shared ruler ── drawn once, all event dots align to its scale */}
            <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* Gutter spacer — aligns ruler with event row content */}
                <div style={{ minWidth: 56, flexShrink: 0 }} />
                <div style={{ width: 1, height: 1, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <HorizonRuler maxDays={maxDays} />
                </div>
              </div>
            </section>

            {/* ── Event rows ── gap 13 between rows (spacing scale rhythm) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {events.map((event, idx) => (
                <EventRow
                  // Index as key is safe here — events list is prop-controlled and
                  // ordered by days; stable within a single modal open.
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered stable list
                  key={idx}
                  event={event}
                  maxDays={maxDays}
                  isToday={event.days === 0}
                />
              ))}
            </div>

            {/* Horizon scale caption below list */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: 13,
              }}
            >
              <span className="cap" style={{ fontSize: 9.5 }}>
                Scale: 0 – {maxDays} days
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
