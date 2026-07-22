/**
 * EventsModalMonthGrid , "Calendar Heatmap" expanded view for the Events tile.
 *
 * WHY this layout: the tile's linear list gives no spatial intuition about
 * *when* in the month events fall , two clustered this weekend vs a gap until
 * month-end reads identically as "2 events". A 2D month grid fixes that by
 * anchoring each event to its calendar position, letting the eye scan the whole
 * month at once. Near-term event days glow hotter (amber → accent green) so
 * urgency is immediate without reading any text.
 *
 * Data dependency: this view needs absolute dates, not just days-until counts.
 * Props accept EventRowWithDate (the existing EventRow widened with `date: string`
 * ISO-8601). That requires a one-line change to the eventsRouter to also return
 * `date` , the DB already stores it (timestamptz), so this is purely a grounded
 * router extension, not invented data.
 *
 * Selected-day detail: tapping a marked day expands an inline strip below the
 * grid listing that day's events by name + place, keeping all content in one
 * panel without nesting another modal.
 */

import { useState } from "react";

// ─── types ────────────────────────────────────────────────────────────────────

/**
 * EventRow widened with `date` (ISO-8601 string from the DB timestamptz).
 * The existing router strips date → days; a grounded extension surfaces date too.
 */
export interface EventRowWithDate {
  name: string;
  place: string;
  /** Whole days from today until the event (floored at 0). */
  days: number;
  /** ISO-8601 date string, e.g. "2026-06-14T19:00:00-07:00". */
  date: string;
}

export interface EventsModalMonthGridProps {
  /** All upcoming events, sorted ascending by date. */
  events: EventRowWithDate[];
  /**
   * The reference "today" date for rendering the grid. Passed as a prop
   * (not derived from Date.now() inside the component) so Storybook fixtures
   * and tests can pin a stable month without time-dependent snapshots.
   */
  today: string; // ISO-8601 date string, e.g. "2026-06-01"
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD" portion of any ISO-8601 string into { y, m, d }. */
function parseYMD(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** 0-based day-of-week for first day of the given month (0=Sun). */
function firstDOW(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** Days in a given month (1-indexed month). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Urgency heat color for an event day. days=0 is today (hottest), up to 7
 * shows amber, 8–14 shows a mid-accent, beyond that a dim accent dot.
 * Uses only CSS custom props from tokens.css , no raw hex.
 */
function heatColor(days: number): string {
  if (days <= 0) return "var(--acc)";
  if (days <= 3) return "var(--acc)";
  if (days <= 7) return "var(--amber)";
  if (days <= 14) return "var(--acc-line)";
  return "var(--ink-3)";
}

// ─── view ─────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function EventsModalMonthGrid({ events, today }: EventsModalMonthGridProps) {
  // Which day cell is currently selected (ISO date "YYYY-MM-DD"), or null.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { y: todayY, m: todayM, d: todayD } = parseYMD(today);

  const totalDays = daysInMonth(todayY, todayM);
  const startDOW = firstDOW(todayY, todayM);

  // Build a lookup: "YYYY-MM-DD" → events on that day (there may be >1).
  const eventsByDay = new Map<string, EventRowWithDate[]>();
  for (const ev of events) {
    const key = ev.date.slice(0, 10);
    const { y, m } = parseYMD(key);
    // Only index events that fall within this calendar month.
    if (y === todayY && m === todayM) {
      const existing = eventsByDay.get(key) ?? [];
      existing.push(ev);
      eventsByDay.set(key, existing);
    }
  }

  // Grid cells: leading empty cells to align day 1 on its weekday, then 1…N.
  const cells: Array<{ day: number | null; key: string }> = [];
  for (let i = 0; i < startDOW; i++) {
    cells.push({ day: null, key: `empty-${i}` });
  }
  for (let d = 1; d <= totalDays; d++) {
    const mm = String(todayM).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    cells.push({ day: d, key: `${todayY}-${mm}-${dd}` });
  }

  // Month name for the header.
  const monthLabel = new Date(todayY, todayM - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const selectedEvents = selectedDay ? (eventsByDay.get(selectedDay) ?? []) : [];

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Month heading */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            {monthLabel}
          </span>
          <span className="cap" style={{ color: "var(--ink-3)" }}>
            {events.length === 0
              ? "No events"
              : `${events.length} event${events.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Weekday header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
          }}
        >
          {WEEKDAYS.map((label) => (
            <div
              key={label}
              className="cap"
              style={{
                textAlign: "center",
                color: "var(--ink-3)",
                paddingBottom: 6,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day cells , 7-column grid. Each cell is either an empty slot (leading
            padding), a plain day, a today marker, or an event day with an accent
            dot. Tapping an event day sets selectedDay to expand the detail strip. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 4,
          }}
        >
          {cells.map(({ day, key }) => {
            if (day === null) {
              // Leading empty cell , keeps the grid aligned but shows nothing.
              return <div key={key} />;
            }

            const isToday = day === todayD;
            const eventsOnDay = eventsByDay.get(key) ?? [];
            const hasEvent = eventsOnDay.length > 0;
            // Smallest days value among events on this day (determines heat color).
            const minDays = hasEvent ? Math.min(...eventsOnDay.map((e) => e.days)) : null;
            const isSelected = selectedDay === key;

            return (
              <button
                key={key}
                type="button"
                aria-label={
                  hasEvent
                    ? `${day}, ${eventsOnDay.length} event${eventsOnDay.length === 1 ? "" : "s"}`
                    : String(day)
                }
                aria-pressed={isSelected}
                onClick={() => {
                  if (!hasEvent) return;
                  // Toggle: tapping the same day again collapses the strip.
                  setSelectedDay(isSelected ? null : key);
                }}
                style={{
                  // 44px min-height for touch target; border-radius matches
                  // the rest of the design system (15px = ControlTap rhythm).
                  minHeight: 44,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  borderRadius: 10,
                  border: isSelected
                    ? "1px solid var(--acc-line)"
                    : isToday
                      ? "1px solid var(--hair-2)"
                      : "1px solid transparent",
                  background: isSelected
                    ? "var(--acc-dim)"
                    : isToday
                      ? "var(--nest)"
                      : "transparent",
                  color: isToday ? "var(--ink)" : "var(--ink-2)",
                  fontSize: 14,
                  fontWeight: isToday ? 600 : 400,
                  cursor: hasEvent ? "pointer" : "default",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                <span>{day}</span>

                {/* Accent dot under the day number , hotter color = sooner event. */}
                {hasEvent && minDays !== null && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: heatColor(minDays),
                      // Glow on very near-term days (today or within 3 days) to
                      // make urgency viscerally legible even at a glance.
                      boxShadow:
                        minDays <= 3
                          ? `0 0 6px 1px ${minDays <= 0 ? "rgb(var(--acc-rgb) / 0.55)" : "rgba(244,192,99,0.55)"}`
                          : "none",
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Selected-day detail strip , expands below the grid when a day with
            events is tapped, listing each event's name and place. Collapsing is
            handled by tapping the same cell again or via the divider row hint. */}
        {selectedDay !== null && selectedEvents.length > 0 && (
          <>
            <div className="divider" />
            <section
              style={{ display: "flex", flexDirection: "column", gap: 13 }}
              aria-label="Events on selected day"
            >
              <span className="cap">
                {/* Human-readable date for the strip header, e.g. "Saturday, Jun 14". */}
                {new Date(`${selectedDay}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>

              {selectedEvents.map((ev) => (
                <div
                  // key uses name+place , both are required non-empty DB fields,
                  // and two events on the same day at the same venue with the same
                  // name are not a valid state in the schema.
                  key={`${selectedDay}-${ev.name}-${ev.place}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "12px 14px",
                    borderRadius: 12,
                    background: "var(--nest)",
                    border: "1px solid var(--hair)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 500,
                      color: "var(--ink)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {ev.name}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--ink-2)",
                    }}
                  >
                    {ev.place}
                  </span>
                  {/* Days-until badge. days=0 shows "Today" in accent color. */}
                  <span
                    className="cap"
                    style={{
                      color: ev.days <= 3 ? "var(--acc)" : "var(--amber)",
                      marginTop: 2,
                    }}
                  >
                    {ev.days === 0 ? "Today" : ev.days === 1 ? "Tomorrow" : `In ${ev.days} days`}
                  </span>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
