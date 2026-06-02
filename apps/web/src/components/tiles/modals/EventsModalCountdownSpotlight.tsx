/**
 * EventsModalCountdownSpotlight — a hero "how far away is the next thing" panel.
 *
 * WHY this layout: the flat tile shows three events as numbers. That's a list.
 * This modal turns the nearest event into a visceral proximity signal: a
 * BorderProgressRing fills as the countdown approaches zero, wrapping a giant
 * day number so your eye lands on ONE thing — urgency made visual.
 *
 * The ring uses a fixed 200×200 container so BorderProgressRing can measure
 * it correctly (explicit width/height avoid a ResizeObserver timing race in
 * Storybook). Progress maps days→[0,1] over a 90-day horizon: 0 days = full
 * ring (green), 90+ days = empty ring (dim). The fill color steps from
 * var(--ink-3) (far away) through var(--amber) (closing in, ≤14d) to
 * var(--acc) (imminent, ≤3d) so urgency reads even without reading the number.
 *
 * Below a divider: a compact "upcoming after" list — each event as a Pill row
 * showing days + name, capped at 4 items so it doesn't overwhelm the hero.
 *
 * PURE VIEW — all data + callbacks via props. No trpc/hooks.
 */

import { BorderProgressRing, Modal, Pill, PillTone } from "../../ui";
import type { EventRow } from "../EventsTileView";

// Days above this are treated as "maximum distance" for the ring fill.
const RING_HORIZON = 90;

/** Map days remaining onto a ring fill fraction 0..1, inverted: 0 days = 1.0. */
function daysToProgress(days: number): number {
  const clamped = Math.max(0, Math.min(days, RING_HORIZON));
  return 1 - clamped / RING_HORIZON;
}

/** Stroke color that communicates urgency: green when imminent, amber midway, dim when far. */
function ringColor(days: number): string {
  if (days <= 3) return "var(--acc)";
  if (days <= 14) return "var(--amber)";
  return "var(--ink-3)";
}

/** Day-count label color mirrors the ring. */
function dayLabelColor(days: number): string {
  if (days <= 3) return "var(--acc)";
  if (days <= 14) return "var(--amber)";
  return "var(--ink)";
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface EventsModalCountdownSpotlightProps {
  open: boolean;
  onClose: () => void;
  /** All events, pre-sorted ascending by date. events[0] = hero; events[1..] = peek list. */
  events: EventRow[];
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function EventsModalCountdownSpotlight({
  open,
  onClose,
  events,
}: EventsModalCountdownSpotlightProps) {
  const hero = events[0] ?? null;
  const after = events.slice(1, 5);

  return (
    <Modal open={open} onClose={onClose} title="Events" width={560} maxHeight={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Hero spotlight — ring + day count + name/place */}
        {hero === null ? (
          // No upcoming events state — centered quiet message.
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 220,
              gap: 10,
            }}
          >
            <span style={{ fontSize: 40, lineHeight: 1 }}>—</span>
            <span className="cap">No upcoming events</span>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
            }}
          >
            {/* Proximity ring: fixed 200×200 so BorderProgressRing measures immediately.
                position:relative is required — the SVG uses position:absolute inset:0. */}
            <div
              style={{
                position: "relative",
                width: 200,
                height: 200,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                borderRadius: 20,
              }}
            >
              <BorderProgressRing
                progress={daysToProgress(hero.days)}
                strokeWidth={4}
                color={ringColor(hero.days)}
                trackColor="var(--hair)"
                radius={20}
                transitionMs={600}
                width={200}
                height={200}
              />
              {/* Giant day count — the one number you're supposed to read. */}
              <span
                className="mono"
                style={{
                  fontSize: 72,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: dayLabelColor(hero.days),
                  letterSpacing: "-0.04em",
                }}
              >
                {hero.days}
              </span>
              <span className="cap" style={{ fontSize: 12 }}>
                days away
              </span>
            </div>

            {/* Name and place beneath the ring — readable at a glance. */}
            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 5 }}>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                }}
              >
                {hero.name}
              </span>
              <span style={{ fontSize: 14, color: "var(--ink-3)" }}>{hero.place}</span>
            </div>
          </div>
        )}

        {/* Divider — only shown when there's a hero and a peek list */}
        {hero !== null && after.length > 0 && <div className="divider" />}

        {/* Upcoming after — compact Pill rows, capped at 4. The label uses the
            same urgency color logic as the ring so proximity reads consistently. */}
        {after.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Upcoming after</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {after.map((ev) => (
                <div
                  key={`${ev.name}-${ev.place}-${ev.days}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 13,
                    padding: "10px 14px",
                    borderRadius: 12,
                    background: "var(--nest)",
                    border: "1px solid var(--hair)",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {ev.name}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--ink-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {ev.place}
                    </span>
                  </div>
                  {/* Days pill — tone communicates urgency without reading the number. */}
                  <Pill
                    tone={ev.days <= 3 ? PillTone.On : PillTone.Default}
                    style={
                      ev.days <= 14 && ev.days > 3
                        ? {
                            background: "rgba(244, 192, 99, 0.1)",
                            borderColor: "rgba(244, 192, 99, 0.35)",
                            color: "var(--amber)",
                          }
                        : undefined
                    }
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {ev.days}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>d</span>
                  </Pill>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
