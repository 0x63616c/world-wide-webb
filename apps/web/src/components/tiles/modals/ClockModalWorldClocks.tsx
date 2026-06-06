/**
 * ClockModalWorldClocks — "World Clocks" expanded view for the Clock tile.
 *
 * WHY this layout: the single-clock tile only knows one timezone (Los Angeles).
 * This modal adds global time awareness in a scannable vertical list — each row
 * shows a city, its current time, and a thin 24h day-progress bar that encodes
 * whether that city is in daytime or night without any text. The home row is
 * pinned and accented at top so Calum's own timezone is always the anchor.
 *
 * WHY pure client-side Intl math: world-clock times are 100% derivable from the
 * browser's clock via Intl.DateTimeFormat — no backend call, no loading state,
 * never fails. Ticks every second via a useEffect interval on `now`.
 *
 * WHY 560 wide: this is a narrow agenda concept (tall rows, not wide columns)
 * so the default 640 is unnecessary width. 560 keeps it compact and readable at
 * a glance on the fixed 1366x1024 panel.
 *
 * PURE view: `now` (current Date) arrives via props so the component is
 * testable/storied without real timers. The board wires in a live ticking Date.
 */

import { Modal, StatusDot } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ClockZone {
  /** City label shown in the row. */
  city: string;
  /** IANA timezone string, e.g. "America/New_York". */
  tz: string;
  /** True for the home row — pinned at top, rendered with the accent colour. */
  home?: boolean;
}

export interface ClockModalWorldClocksProps {
  open: boolean;
  onClose: () => void;
  /**
   * Current wall-clock moment. Passed via props (not Date.now() inside the
   * component) so Storybook/tests can supply a fixed instant for deterministic
   * snapshots, and so the board can drive the tick externally.
   */
  now: Date;
  /**
   * Ordered list of timezones to display. Home row should come first (or be
   * flagged `home: true`) — the component pins it visually regardless of order.
   */
  zones: ClockZone[];
}

// ─── constants ────────────────────────────────────────────────────────────────

// Intl formatters are constructed once per call to derive components from a
// given (tz, now) pair. All use "en-US" for consistent AM/PM notation and
// predictable weekday names on the fixed LA-locale wall panel.
function getTimeParts(tz: string, now: Date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(now);

  const hourNum = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  // UTC offset string: derive the wall-clock hour-of-day in UTC, compare.
  const utcOffset = (() => {
    const utcHour = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const tzHour = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    // Compute offset in whole minutes from the two wall-clock times.
    const toMins = (parts: Intl.DateTimeFormatPart[]) => {
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      return h * 60 + m;
    };
    let diff = toMins(tzHour) - toMins(utcHour);
    // Wrap across midnight
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    const sign = diff >= 0 ? "+" : "−";
    const absH = Math.floor(Math.abs(diff) / 60);
    const absM = Math.abs(diff) % 60;
    return `UTC${sign}${absH}${absM ? `:${String(absM).padStart(2, "0")}` : ""}`;
  })();

  // 24h progress: fraction of the day elapsed in this timezone (0 at midnight, 1 at next midnight).
  const minutesIntoDay = (() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  })();
  const dayProgress = minutesIntoDay / 1440; // 0..1

  // Daytime: roughly 6:00–21:00 local (covers most of civil daylight without
  // needing actual sunrise/sunset for non-home zones).
  const isDaytime = hourNum >= 6 && hourNum < 21;

  return { hour, weekday, utcOffset, dayProgress, isDaytime };
}

// ─── sub-components ───────────────────────────────────────────────────────────

// Tiny 24h progress bar showing where in the day this timezone currently sits.
// The filled region is amber during daytime, muted at night so "asleep" reads
// visually without any label.
function DayProgressBar({ progress, isDaytime }: { progress: number; isDaytime: boolean }) {
  const fillColor = isDaytime ? "var(--amber)" : "var(--ink-3)";
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%",
        height: 3,
        borderRadius: 999,
        background: "var(--nest)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.round(progress * 100)}%`,
          height: "100%",
          borderRadius: 999,
          background: fillColor,
          transition: "width 1s linear",
        }}
      />
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockModalWorldClocks({ open, onClose, now, zones }: ClockModalWorldClocksProps) {
  // Pin home row first, then remaining zones in their given order.
  const sorted = [...zones].sort((a, b) => {
    if (a.home && !b.home) return -1;
    if (!a.home && b.home) return 1;
    return 0;
  });

  return (
    <Modal open={open} onClose={onClose} title="Clock" width={560} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {sorted.map((zone, idx) => {
          const { hour, weekday, utcOffset, dayProgress, isDaytime } = getTimeParts(zone.tz, now);
          const isHome = !!zone.home;

          return (
            <div key={zone.tz}>
              {/* Divider between home row and the rest */}
              {idx === 1 && <div className="divider" style={{ marginBottom: 13 }} />}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "14px 16px",
                  borderRadius: 14,
                  background: isHome ? "var(--acc-dim)" : "var(--nest)",
                  border: `1px solid ${isHome ? "var(--acc-line)" : "var(--hair)"}`,
                }}
              >
                {/* Top row: city + offset left | time right */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  {/* Left: city name + UTC offset */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: isHome ? "var(--acc)" : "var(--ink)",
                        lineHeight: 1.2,
                      }}
                    >
                      {zone.city}
                    </span>
                    <span
                      className="mono cap"
                      style={{
                        fontSize: 10,
                        color: isHome ? "var(--acc-line)" : "var(--ink-3)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {utcOffset}
                    </span>
                  </div>

                  {/* Right: large time + weekday */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: isHome ? "var(--acc)" : "var(--ink)",
                        letterSpacing: "-0.04em",
                        lineHeight: 1,
                      }}
                    >
                      {hour}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        color: isHome ? "var(--acc)" : "var(--ink-2)",
                        opacity: 0.75,
                        fontWeight: 500,
                      }}
                    >
                      {weekday}
                    </span>
                  </div>
                </div>

                {/* Bottom row: day-progress bar + day/night StatusDot */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <DayProgressBar progress={dayProgress} isDaytime={isDaytime} />
                  </div>
                  <StatusDot online={isDaytime} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
