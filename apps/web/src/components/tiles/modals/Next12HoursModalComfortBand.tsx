/**
 * Next12HoursModalComfortBand — "Comfort & Layer Advisor" detail modal for
 * the Next 12 Hours tile. The tile buries feels-like as a faint dotted
 * secondary line; here it drives the entire view.
 *
 * Layout logic:
 *  - Top: horizontal comfort ribbon — one coloured segment per hour, labelled
 *    beneath, classified by feels into Cold / Cool / Mild / Warm bands using
 *    fixed thresholds (no invented data, purely derived from real feels values).
 *  - Middle: "Sharpest drop" stat callout (largest negative feels delta between
 *    adjacent hours) + Hi / Lo envelope StatCells. If the 12-hour window is
 *    entirely rising, shows "Sharpest rise" instead so the callout is always
 *    meaningful.
 *  - Bottom: compact per-hour temp-vs-feels gap bars — shows how far the body
 *    feels from the raw thermometer reading each hour.
 *
 * PURE view: all data + callbacks arrive via props. No trpc/hooks. Composes
 * trivially in Storybook + tests.
 */

import { Modal, Stat } from "../../ui";
import type { HourlyEntry } from "../Next12HoursView";

// Subset of weather.now fields used by this modal — sourced from the tRPC
// weather router's WeatherNow interface. Defined locally to avoid coupling the
// web view to the API service's type file.
interface NowEnvelope {
  hi: number;
  lo: number;
  feels: number;
}

// ─── comfort band classification ──────────────────────────────────────────────

// Fixed thresholds (°F feels-like). These boundary choices are deliberate:
//  ≤ 49  = Cold  — jacket-or-coat territory
//  50-59 = Cool  — light layer recommended
//  60-69 = Mild  — comfortable, no extra layer
//  ≥ 70  = Warm  — shorts weather
// Derived purely from the real feels value; no invented fields.

type Band = "cold" | "cool" | "mild" | "warm";

interface BandConfig {
  label: string;
  color: string;
  textColor: string;
}

const BAND_CONFIG: Record<Band, BandConfig> = {
  cold: { label: "Cold", color: "var(--ink-3)", textColor: "var(--ink-2)" },
  cool: { label: "Cool", color: "var(--acc-dim, rgba(91,227,125,0.12))", textColor: "var(--acc)" },
  mild: { label: "Mild", color: "rgba(91,227,125,0.25)", textColor: "var(--acc)" },
  warm: { label: "Warm", color: "rgba(244,192,99,0.22)", textColor: "var(--amber)" },
};

function classifyFeels(f: number): Band {
  if (f <= 49) return "cold";
  if (f <= 59) return "cool";
  if (f <= 69) return "mild";
  return "warm";
}

// ─── swing detection ──────────────────────────────────────────────────────────

interface Swing {
  /** Negative = drop, positive = rise. The largest absolute delta. */
  delta: number;
  fromLabel: string;
  toLabel: string;
  fromFeels: number;
  toFeels: number;
}

function detectSharpestSwing(hours: HourlyEntry[]): Swing | null {
  if (hours.length < 2) return null;
  let best: Swing | null = null;
  for (let i = 0; i < hours.length - 1; i++) {
    const delta = hours[i + 1].feels - hours[i].feels;
    if (best === null || Math.abs(delta) > Math.abs(best.delta)) {
      best = {
        delta,
        fromLabel: hours[i].t,
        toLabel: hours[i + 1].t,
        fromFeels: hours[i].feels,
        toFeels: hours[i + 1].feels,
      };
    }
  }
  return best;
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface Next12HoursModalComfortBandProps {
  open: boolean;
  onClose: () => void;
  /** 12 hourly entries from the weather router — same shape as Next12HoursView */
  hours: HourlyEntry[];
  /** Current conditions — supplies hi, lo, feels for the day envelope */
  now: NowEnvelope;
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function Next12HoursModalComfortBand({
  open,
  onClose,
  hours,
  now,
}: Next12HoursModalComfortBandProps) {
  const swing = detectSharpestSwing(hours);
  const isAllRising = swing !== null && swing.delta > 0;

  // Compute temp-vs-feels gap range for scaling the gap bars.
  const gaps = hours.map((h) => Math.abs(h.temp - h.feels));
  const maxGap = Math.max(...gaps, 1);

  return (
    <Modal open={open} onClose={onClose} title="Next 12 Hours" width={640} maxHeight={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* ── Comfort ribbon ─────────────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">Comfort band</span>
          {/* Ribbon row: one segment per hour */}
          <div style={{ display: "flex", gap: 3 }}>
            {hours.map((h) => {
              const band = classifyFeels(h.feels);
              const cfg = BAND_CONFIG[band];
              return (
                <div
                  key={h.t}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0,
                  }}
                >
                  {/* Coloured segment */}
                  <div
                    title={`${h.t}: ${h.feels}° feels — ${cfg.label}`}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 6,
                      background: cfg.color,
                      border: "1px solid var(--hair)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: cfg.textColor,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {h.feels}°
                    </span>
                  </div>
                  {/* Hour label */}
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      color: "var(--ink-3)",
                      marginTop: 4,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {h.t}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Band legend */}
          <div style={{ display: "flex", gap: 13, marginTop: 4 }}>
            {(["cold", "cool", "mild", "warm"] as Band[]).map((band) => {
              const cfg = BAND_CONFIG[band];
              return (
                <div key={band} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: cfg.color,
                      border: "1px solid var(--hair)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{cfg.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="divider" />

        {/* ── Swing callout + envelope stats ─────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap">{isAllRising ? "Sharpest rise" : "Sharpest drop"}</span>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 13 }}>
            {/* Swing callout — biggest adjacent feels delta */}
            <div
              style={{
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                borderRadius: 13,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {swing ? (
                <>
                  <span
                    className="mono"
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: swing.delta < 0 ? "var(--ink)" : "var(--amber)",
                      letterSpacing: "-0.03em",
                      lineHeight: 1,
                    }}
                  >
                    {swing.delta > 0 ? "+" : ""}
                    {swing.delta}°
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
                    feels {swing.fromLabel}→{swing.toLabel}
                    <br />
                    {swing.fromFeels}° → {swing.toFeels}°
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>—</span>
              )}
            </div>

            {/* Day hi / lo / feels envelope from weather.now */}
            <Stat label="Hi" value={`${now.hi}°`} />
            <Stat label="Lo" value={`${now.lo}°`} muted />
            <Stat label="Feels now" value={`${now.feels}°`} accent />
          </div>
        </section>

        <div className="divider" />

        {/* ── Temp vs feels gap bars ──────────────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span className="cap">Temp vs feels gap</span>
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
              wider bar = larger difference
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {hours.map((h) => {
              const gap = Math.abs(h.temp - h.feels);
              const pct = (gap / maxGap) * 100;
              // When temp > feels the air is warmer than it feels (wind/humidity chill).
              // When feels > temp it's rare (humid heat index) but possible.
              const colder = h.temp >= h.feels;
              return (
                <div key={h.t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Hour label */}
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--ink-3)", width: 36, flexShrink: 0 }}
                  >
                    {h.t}
                  </span>
                  {/* Bar track */}
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--nest)",
                      border: "1px solid var(--hair)",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        height: "100%",
                        width: `${pct}%`,
                        borderRadius: 999,
                        // Colder-than-air gaps use accent; heat-index gaps use amber
                        background: colder
                          ? "var(--acc-line, rgba(91,227,125,0.4))"
                          : "rgba(244,192,99,0.5)",
                      }}
                    />
                  </div>
                  {/* Gap label */}
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-2)",
                      width: 44,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {h.temp}°/{h.feels}°
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}
