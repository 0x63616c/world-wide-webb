/**
 * EventsModalFullAgenda — the "Full Agenda" expanded view for the Events tile.
 *
 * WHY this layout: the tile hard-slices to 3 events, so the 4th+ event is
 * completely invisible on the wall panel. This modal's only job is completeness:
 * show every upcoming event in a scannable vertical agenda so the user can see
 * what's actually coming. It reuses the tile's own urgency language (days <= 3
 * accented green) scaled to N rows, not just 3.
 *
 * Layout: a single scrolling column. Left gutter carries the day count in
 * large monospace so urgency reads at a glance — no header, no chrome, just
 * the data. Name + place sit right of the gutter. A StatusDot encodes urgency
 * at the row level for colour-blind legibility alongside the accent.
 *
 * PURE view: all data arrives via props. No trpc/hooks. Composes trivially in
 * Storybook and unit tests. Width 560 (narrow agenda as briefed), maxHeight 760.
 */

import { Modal, StatusDot } from "../../ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface EventRow {
  name: string;
  place: string;
  days: number;
}

export interface EventsModalFullAgendaProps {
  open: boolean;
  onClose: () => void;
  events: EventRow[];
}

// ─── constants ────────────────────────────────────────────────────────────────

// Matches the tile's own rule: days <= 3 renders with the accent colour.
const URGENT_THRESHOLD = 3;

// ─── view ─────────────────────────────────────────────────────────────────────

export function EventsModalFullAgenda({ open, onClose, events }: EventsModalFullAgendaProps) {
  return (
    <Modal open={open} onClose={onClose} title="Events" width={560} maxHeight={760}>
      {events.length === 0 ? (
        // Empty state — no upcoming events in the DB.
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
          <span style={{ fontSize: 28 }} aria-hidden="true">
            📅
          </span>
          <span className="cap" style={{ letterSpacing: "0.12em" }}>
            No upcoming events
          </span>
        </div>
      ) : (
        // Scrolling agenda column. gap 13 between rows keeps the same inner-grid
        // rhythm as the Controls modal. No extra section wrappers needed — the
        // list IS the content.
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {events.map((event, i) => {
            const urgent = event.days <= URGENT_THRESHOLD;
            return (
              // key by index is stable here: the list is pre-sorted ascending by
              // date (soonest first) and events is a read-only prop snapshot.
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: pre-sorted snapshot, index is stable
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: urgent ? "var(--acc-dim)" : "var(--nest)",
                  border: `1px solid ${urgent ? "var(--acc-line)" : "var(--hair)"}`,
                }}
              >
                {/* Day-count gutter — large mono so urgency is unmissable.
                    "TODAY" label for day 0 so it reads as an action item. */}
                <div
                  className="mono"
                  style={{
                    flex: "0 0 52px",
                    textAlign: "center",
                    fontSize: event.days === 0 ? 11 : 22,
                    fontWeight: 600,
                    lineHeight: 1,
                    color: urgent ? "var(--acc)" : "var(--ink-2)",
                    letterSpacing: event.days === 0 ? "0.1em" : "-0.02em",
                    textTransform: event.days === 0 ? "uppercase" : undefined,
                  }}
                >
                  {event.days === 0 ? "TODAY" : event.days}
                </div>

                {/* Name + place — flex-grow so long names wrap naturally within
                    the 560px panel rather than overflowing. */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 500,
                      color: urgent ? "var(--ink)" : "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.name}
                  </span>
                  {event.place && (
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "var(--ink-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {event.place}
                    </span>
                  )}
                </div>

                {/* StatusDot: urgent events get the live green pulse; others
                    get the dim static dot — mirrors the tile's own urgency signal. */}
                <StatusDot online={urgent} />
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
