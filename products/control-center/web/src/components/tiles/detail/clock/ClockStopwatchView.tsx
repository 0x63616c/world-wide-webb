/**
 * ClockStopwatchView , "Stopwatch" variant of the Clock detail page (Apple
 * Clock mental model, clock-suite plan §8).
 *
 * PURE view: `state` + `nowMs` + callbacks arrive via props so the component is
 * testable/storied with fixed instants. The zero-prop `StopwatchVariant`
 * wrapper wires in the stopwatch store and drives `nowMs` via a
 * requestAnimationFrame loop while running , rAF (not a 100 ms interval) is
 * pinned by the plan so the centisecond digits blur like Apple's instead of
 * visibly stepping.
 *
 * Layout: centered giant mm:ss.cc readout (thin tabular numerals), the Apple
 * two-button row underneath , left = Lap (running) / Reset (stopped AND
 * elapsed > 0), right = Start (accent) / Stop , then the lap list newest-first
 * with the live in-progress lap on top. Fastest completed lap tints accent,
 * slowest tints muted (only once ≥2 completed laps exist, via `lapExtremes`).
 */

import { Button } from "@/components/ui";
import { lapExtremes, stopwatchElapsedMs } from "@/lib/time-suite/pure";
import type { StopwatchState } from "@/lib/time-suite/types";

// ─── props ────────────────────────────────────────────────────────────────────

export interface ClockStopwatchViewProps {
  state: StopwatchState;
  /** Current wall-clock instant. Fixed in stories/tests; rAF-driven live. */
  nowMs: number;
  onStart: () => void;
  onStop: () => void;
  onLap: () => void;
  onReset: () => void;
}

// ─── formatting ───────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** mm:ss.cc, rolling to h:mm:ss.cc past an hour (Apple's format). */
export function formatStopwatch(ms: number): string {
  const clamped = Math.max(0, ms);
  const centis = Math.floor(clamped / 10) % 100;
  const totalSeconds = Math.floor(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const core = `${pad2(minutes)}:${pad2(seconds)}.${pad2(centis)}`;
  return hours > 0 ? `${hours}:${core}` : core;
}

// ─── sub-components ───────────────────────────────────────────────────────────

/** One lap row. `tone` drives the Apple fastest/slowest tinting. */
function LapRow({
  label,
  ms,
  tone,
  live,
}: {
  label: string;
  ms: number;
  tone: "fastest" | "slowest" | null;
  live: boolean;
}) {
  const color =
    tone === "fastest" ? "var(--acc)" : tone === "slowest" ? "var(--ink-3)" : "var(--ink)";
  return (
    <div
      data-extreme={tone ?? undefined}
      data-live={live || undefined}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid var(--hair)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: live ? "var(--ink-2)" : color }}>
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 20,
          fontVariantNumeric: "tabular-nums",
          color: live ? "var(--ink-2)" : color,
          letterSpacing: "-0.02em",
        }}
      >
        {formatStopwatch(ms)}
      </span>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockStopwatchView({
  state,
  nowMs,
  onStart,
  onStop,
  onLap,
  onReset,
}: ClockStopwatchViewProps) {
  const elapsedMs = stopwatchElapsedMs(state, nowMs);
  const { fastestId, slowestId } = lapExtremes(state.laps);

  // Apple semantics for the left button: Lap while running, Reset once stopped
  // with time on the clock, and a disabled Lap placeholder at zero.
  const canReset = !state.running && elapsedMs > 0;

  // The in-progress lap rides on top of the list whenever a lap session exists
  // (running, or stopped mid-session with completed laps behind it).
  const inProgressLapMs = elapsedMs - state.lapStartElapsedMs;
  const showInProgressLap = state.running || state.laps.length > 0;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      {/* Giant readout , thin tabular numerals so frames blur, never shift. */}
      <div
        role="timer"
        aria-label="Stopwatch"
        className="mono"
        style={{
          textAlign: "center",
          fontSize: 128,
          fontWeight: 400,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
          padding: "56px 0 40px",
        }}
      >
        {formatStopwatch(elapsedMs)}
      </div>

      {/* Apple two-button row: Lap/Reset left, Start/Stop right (accent). */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
        {state.running ? (
          <Button type="button" variant="ghost" onClick={onLap} style={{ width: 180, height: 56 }}>
            Lap
          </Button>
        ) : canReset ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            style={{ width: 180, height: 56 }}
          >
            Reset
          </Button>
        ) : (
          <Button type="button" variant="ghost" disabled style={{ width: 180, height: 56 }}>
            Lap
          </Button>
        )}
        {state.running ? (
          <Button type="button" onClick={onStop} style={{ width: 180, height: 56 }}>
            Stop
          </Button>
        ) : (
          <Button type="button" onClick={onStart} style={{ width: 180, height: 56 }}>
            Start
          </Button>
        )}
      </div>

      {/* Lap list , newest first, live in-progress lap on top. */}
      {showInProgressLap && (
        <div style={{ maxWidth: 560, margin: "40px auto 0" }}>
          <LapRow label={`Lap ${state.laps.length + 1}`} ms={inProgressLapMs} tone={null} live />
          {state.laps.map((lap, idx) => (
            <LapRow
              key={lap.id}
              label={`Lap ${state.laps.length - idx}`}
              ms={lap.ms}
              tone={lap.id === fastestId ? "fastest" : lap.id === slowestId ? "slowest" : null}
              live={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
