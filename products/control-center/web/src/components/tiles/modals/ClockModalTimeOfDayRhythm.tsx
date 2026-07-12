/**
 * ClockModalTimeOfDayRhythm , "Time-of-Day Rhythm" vertical 24h ribbon.
 *
 * WHY this layout: The Clock tile says "Good evening" without ever explaining
 * why , which greeting bucket applies, when it ends, or how that maps to the
 * real sun. This modal makes the hidden logic legible. A tall vertical ribbon
 * on the left shows all 24 hours as a proportional strip, colored by the four
 * greeting bands (night/morning/afternoon/evening). Two sun/moon markers sit at
 * the exact pixel row for today's real sunrise and sunset (from the weather
 * router). A live "now" line sweeps down the ribbon, showing exactly where the
 * current moment sits inside the day. The right column names the current phase,
 * shows time until the next phase boundary, and surfaces the two solar Stat
 * cells so you can see the relationship between the greeting bucket cutoffs and
 * the actual sun in one glance.
 *
 * No arc, no clock face , the distinct vertical-ribbon format lets you read
 * time remaining as a distance (how much blank ribbon is below the now-line),
 * which is more intuitive than an angular arc for a linear quantity like
 * "hours until next phase".
 *
 * PURE view: all data + callbacks arrive via props (no trpc/hooks). Renders
 * inside the shared <Modal> so backdrop/Escape/close are handled centrally.
 */

import { Modal, Stat } from "@/components/ui";

// ─── constants ────────────────────────────────────────────────────────────────

// Greeting bucket boundaries (hours, 24h). Must stay in sync with ClockGreeting.tsx.
// 0–4  → night (late)
// 5–11 → morning
// 12–16 → afternoon
// 17–21 → evening
// 22–23 → night (early)
const BANDS: { label: string; startHour: number; endHour: number; color: string }[] = [
  { label: "Night", startHour: 0, endHour: 5, color: "rgba(30, 28, 60, 0.85)" },
  { label: "Morning", startHour: 5, endHour: 12, color: "rgba(255, 160, 60, 0.22)" },
  { label: "Afternoon", startHour: 12, endHour: 17, color: "rgba(91, 180, 255, 0.18)" },
  { label: "Evening", startHour: 17, endHour: 22, color: "rgba(180, 100, 255, 0.22)" },
  { label: "Night", startHour: 22, endHour: 24, color: "rgba(30, 28, 60, 0.85)" },
];

const RIBBON_HEIGHT = 600; // px , total height of the 24h ribbon
const RIBBON_WIDTH = 56; // px

// ─── types ────────────────────────────────────────────────────────────────────

export interface ClockModalTimeOfDayRhythmProps {
  open: boolean;
  onClose: () => void;
  /** ISO datetime for today's sunrise, e.g. "2026-05-31T06:02:00" */
  sunriseIso: string;
  /** ISO datetime for today's sunset, e.g. "2026-05-31T19:48:00" */
  sunsetIso: string;
  /** Formatted sunrise time, e.g. "6:02 AM" */
  sunriseFormatted: string;
  /** Formatted sunset time, e.g. "7:48 PM" */
  sunsetFormatted: string;
  /** Current local time as ms since epoch , passed in so the component is
   *  fully pure and deterministic in Storybook without time-stubbing. */
  nowMs: number;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Fraction 0..1 representing position within the 24h day */
function hourFraction(isoOrMs: string | number): number {
  const d = typeof isoOrMs === "string" ? new Date(isoOrMs) : new Date(isoOrMs);
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}

/** Pixel offset from top of ribbon for a given 0..1 fraction */
function fractionToPx(frac: number): number {
  return Math.round(frac * RIBBON_HEIGHT);
}

/** Format whole minutes as "Xh Ym" or "Ym" if < 60 */
function fmtDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return "now";
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Derive current greeting bucket name from hour */
function greetingBucket(hour: number): string {
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 22) return "Evening";
  return "Night";
}

/** Find how many minutes until the next phase boundary (5, 12, 17, 22 , or 29
 *  which wraps to 5 next day). Returns { label, minutesUntil }. */
function nextPhase(nowMs: number): { label: string; minutesUntil: number } {
  const d = new Date(nowMs);
  const hour = d.getHours();
  const minuteOfDay = hour * 60 + d.getMinutes();
  const boundaries: { hour: number; label: string }[] = [
    { hour: 5, label: "Morning" },
    { hour: 12, label: "Afternoon" },
    { hour: 17, label: "Evening" },
    { hour: 22, label: "Night" },
  ];
  for (const b of boundaries) {
    const bMin = b.hour * 60;
    if (minuteOfDay < bMin) return { label: b.label, minutesUntil: bMin - minuteOfDay };
  }
  // Past 22:00 , next is 05:00 tomorrow
  const tomorrowFive = 24 * 60 + 5 * 60;
  return { label: "Morning", minutesUntil: tomorrowFive - minuteOfDay };
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** A single label tick on the ribbon's right edge. */
function HourTick({ hour, top }: { hour: number; top: number }) {
  const label = hour === 0 ? "12a" : hour === 12 ? "12p" : hour < 12 ? `${hour}a` : `${hour - 12}p`;
  return (
    <div
      style={{
        position: "absolute",
        top,
        right: -40,
        transform: "translateY(-50%)",
        fontSize: 10,
        color: "var(--ink-3)",
        fontFamily: "var(--mono)",
        letterSpacing: "-0.02em",
        whiteSpace: "nowrap",
        lineHeight: 1,
        pointerEvents: "none",
      }}
    >
      {label}
    </div>
  );
}

/** Solar event marker (sunrise ☀ or sunset 🌙) pinned at the correct ribbon row. */
function SolarMarker({ top, icon, label }: { top: number; icon: string; label: string }) {
  return (
    <div
      title={label}
      style={{
        position: "absolute",
        top,
        left: RIBBON_WIDTH + 6,
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        color: "var(--amber)",
        fontFamily: "var(--ui)",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 10.5, color: "var(--ink-2)" }}>{label}</span>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockModalTimeOfDayRhythm({
  open,
  onClose,
  sunriseIso,
  sunsetIso,
  sunriseFormatted,
  sunsetFormatted,
  nowMs,
}: ClockModalTimeOfDayRhythmProps) {
  const nowFrac = hourFraction(nowMs);
  const nowPx = fractionToPx(nowFrac);

  const sunrisePx = fractionToPx(hourFraction(sunriseIso));
  const sunsetPx = fractionToPx(hourFraction(sunsetIso));

  const nowDate = new Date(nowMs);
  const currentHour = nowDate.getHours();
  const currentBucket = greetingBucket(currentHour);
  const { label: nextLabel, minutesUntil } = nextPhase(nowMs);

  // Day length in minutes from sunrise to sunset
  const sunriseMs = new Date(sunriseIso).getTime();
  const sunsetMs = new Date(sunsetIso).getTime();
  const dayLengthMin = Math.max(0, (sunsetMs - sunriseMs) / 60_000);
  const daylightRemainingMin = Math.max(0, (sunsetMs - nowMs) / 60_000);

  // Hour ticks at 0, 6, 12, 18 (and 24 = top of next day, which is 0)
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <Modal open={open} onClose={onClose} title="Clock" width={600} maxHeight={740}>
      {/* Two-column layout: left = ribbon, right = phase info + solar stats.
          gap 24 keeps the same rhythm as Controls modal sections. */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* ── Left: 24h ribbon ────────────────────────────────────────────── */}
        <div
          style={{
            // Extra right margin leaves room for solar markers that overflow right
            marginRight: 80,
            position: "relative",
            flex: "0 0 auto",
          }}
        >
          {/* Ribbon container */}
          <div
            style={{
              position: "relative",
              width: RIBBON_WIDTH,
              height: RIBBON_HEIGHT,
              borderRadius: 10,
              overflow: "visible",
              border: "1px solid var(--hair-2)",
            }}
          >
            {/* Greeting band fills , colored by time-of-day */}
            {BANDS.map((band, i) => {
              const top = fractionToPx(band.startHour / 24);
              const height = fractionToPx((band.endHour - band.startHour) / 24);
              const isFirst = i === 0;
              const isLast = i === BANDS.length - 1;
              return (
                <div
                  key={`${band.label}-${band.startHour}`}
                  title={`${band.label} (${band.startHour}:00 – ${band.endHour}:00)`}
                  style={{
                    position: "absolute",
                    top,
                    left: 0,
                    width: "100%",
                    height,
                    background: band.color,
                    borderRadius: isFirst ? "10px 10px 0 0" : isLast ? "0 0 10px 10px" : 0,
                  }}
                />
              );
            })}

            {/* Hour tick marks , hairline left-edge notches */}
            {hourTicks.map((h) => {
              const top = fractionToPx(h / 24);
              return (
                <div
                  key={h}
                  style={{
                    position: "absolute",
                    top,
                    left: 0,
                    width: "100%",
                    height: 1,
                    background: "var(--hair-2)",
                    pointerEvents: "none",
                  }}
                />
              );
            })}

            {/* Now-line , live sweep indicator */}
            <div
              role="presentation"
              style={{
                position: "absolute",
                top: nowPx,
                left: -4,
                width: RIBBON_WIDTH + 8,
                height: 2,
                background: "var(--acc)",
                boxShadow: "0 0 8px var(--acc-line)",
                borderRadius: 1,
                zIndex: 10,
                pointerEvents: "none",
              }}
            />
            {/* Now-line dot on the left edge */}
            <div
              style={{
                position: "absolute",
                top: nowPx - 4,
                left: -8,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--acc)",
                boxShadow: "0 0 0 2px var(--tile), 0 0 10px var(--acc-line)",
                zIndex: 11,
                pointerEvents: "none",
              }}
            />
          </div>

          {/* Hour tick labels , outside the clipped ribbon container */}
          {hourTicks.map((h) => (
            <HourTick key={h} hour={h} top={fractionToPx(h / 24)} />
          ))}

          {/* Solar markers , overlaid outside the ribbon */}
          <SolarMarker top={sunrisePx} icon="☀" label={sunriseFormatted} />
          <SolarMarker top={sunsetPx} icon="🌙" label={sunsetFormatted} />
        </div>

        {/* ── Right: phase info + solar stats ─────────────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 24,
            paddingTop: 8,
          }}
        >
          {/* Current phase */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Current phase</span>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: "var(--ink)",
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {currentBucket}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
              {currentHour < 10 ? `0${currentHour}` : `${currentHour}`}:
              {String(nowDate.getMinutes()).padStart(2, "0")}{" "}
              <span style={{ color: "var(--ink-3)" }}>local</span>
            </div>
          </section>

          {/* Time until next phase */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Until next phase</span>
            <Stat label={nextLabel} value={fmtDuration(minutesUntil)} accent={minutesUntil < 30} />
          </section>

          {/* Divider */}
          <div className="divider" />

          {/* Solar stats */}
          <section style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <span className="cap">Solar</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <Stat label="Sunrise" value={sunriseFormatted} />
              <Stat label="Sunset" value={sunsetFormatted} />
              <Stat
                label="Day length"
                value={fmtDuration(dayLengthMin)}
                muted={dayLengthMin === 0}
              />
              {/* Only show daylight remaining if we're still before sunset */}
              {nowMs < sunsetMs && (
                <Stat
                  label="Daylight left"
                  value={fmtDuration(daylightRemainingMin)}
                  accent={daylightRemainingMin < 60}
                />
              )}
            </div>
          </section>

          {/* Band legend , small color chips so the ribbon colors are named */}
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="cap">Greeting bands</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "Night", range: "10p – 5a", color: BANDS[0].color },
                { label: "Morning", range: "5a – 12p", color: BANDS[1].color },
                { label: "Afternoon", range: "12p – 5p", color: BANDS[2].color },
                { label: "Evening", range: "5p – 10p", color: BANDS[3].color },
              ].map(({ label, range, color }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: color,
                      border: "1px solid var(--hair-2)",
                      flex: "0 0 auto",
                    }}
                  />
                  <span style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: "auto" }}>
                    {range}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
