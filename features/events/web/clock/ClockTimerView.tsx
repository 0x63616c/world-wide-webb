/**
 * ClockTimerView , the Timer variant of the Clock detail page (the flagship
 * page of the clock suite, Apple Clock "Timers" mental model).
 *
 * PURE presentational: timers + `nowMs` arrive via props and every gesture
 * routes through a callback, so stories/tests pin fixed instants and the
 * store wiring lives entirely in TimerVariant. Remaining time is derived
 * here from the record's absolute deadline (`endsAtMs - nowMs`) , the view
 * re-renders on the caller's cadence and never runs its own clock.
 *
 * Layout law (plan §8): 1 timer = centered hero card; 2-4 = 2-column grid
 * with scaled digits; >4 = the grid scrolls. The right rail is "New Timer":
 * a preset grid plus three WheelPicker columns (H/M/S) and Start , the
 * kiosk's one sanctioned time-entry mechanism (TextInput is banned).
 *
 * Card anatomy: label + original duration small above; remaining time in
 * huge thin tabular-numeral digits (accent-tinted in the final 10 s ,
 * countdownTick urgency precedent); a BorderProgressRing tracing
 * fraction-remaining around the card border in a 5.5 px accent stroke. A
 * done timer's card swaps to an accent-filled ringing state with a big
 * Stop. Every tappable honors the 44 px hit-area law.
 */

import { type CSSProperties, useState } from "react";
import { BorderProgressRing, Button, WheelPicker, type WheelPickerValue } from "@/components/ui";
import { formatDurationLabel, pad2 } from "@/lib/time-suite/pure";
import type { TimerRecord } from "@/lib/time-suite/types";

// ─── props ────────────────────────────────────────────────────────────────────

/** Per-timer gestures a card can raise , shared by the view and TimerCard. */
interface TimerActions {
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  /** Remove a running/paused timer. */
  onDelete: (id: string) => void;
  /** Clear a done timer's card. */
  onDismiss: (id: string) => void;
  /** Re-run a timer from its original duration. */
  onRestart: (id: string) => void;
  /** Silence a ringing done timer; the card stays. */
  onStopRinging: (id: string) => void;
}

export interface ClockTimerViewProps extends TimerActions {
  timers: TimerRecord[];
  /** Current instant; the caller drives the tick cadence. */
  nowMs: number;
  /** Start a new running timer of this length. */
  onAdd: (durationMs: number) => void;
}

// ─── time formatting ──────────────────────────────────────────────────────────

/** Big-digit remaining readout: "M:SS", or "H:MM:SS" from one hour up.
 *  Ceiled to the second (Apple: a fresh 10:00 timer reads 10:00, not 9:59). */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Remaining ms for a record at `nowMs` , absolute deadline while running,
 *  the stored authoritative value while paused, zero once done. */
function remainingMsOf(t: TimerRecord, nowMs: number): number {
  if (t.state === "running" && t.endsAtMs !== null) return Math.max(0, t.endsAtMs - nowMs);
  if (t.state === "paused") return t.remainingMs;
  return 0;
}

// ─── shared bits ──────────────────────────────────────────────────────────────

const CARD_RADIUS = 18;
/** Wall-distance-visible ring stroke (the 2.5 px default vanishes). */
const RING_STROKE = 5.5;
/** Digits tint accent inside this window (countdownTick urgency precedent). */
const FINAL_ACCENT_MS = 10_000;

/** 44 px square icon button , the delete/dismiss X in a card corner. */
function CornerX({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      style={{
        width: 44,
        height: 44,
        margin: -12, // visual size stays compact; hit target stays 44
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: "var(--ink-3)",
        fontSize: 16,
        lineHeight: 1,
        cursor: "pointer",
        borderRadius: 12,
        flexShrink: 0,
      }}
    >
      ✕
    </button>
  );
}

// ─── timer card ───────────────────────────────────────────────────────────────

interface TimerCardProps extends TimerActions {
  timer: TimerRecord;
  nowMs: number;
  /** hero = single centered flagship card; grid = 2-column scaled-down card. */
  size: "hero" | "grid";
}

function TimerCard({
  timer,
  nowMs,
  size,
  onPause,
  onResume,
  onDelete,
  onDismiss,
  onRestart,
  onStopRinging,
}: TimerCardProps) {
  const hero = size === "hero";
  const remaining = remainingMsOf(timer, nowMs);
  const fraction = timer.durationMs > 0 ? Math.min(1, remaining / timer.durationMs) : 0;
  const ringing = timer.state === "done" && !timer.dismissedCue;
  const title = timer.label ?? "Timer";
  const subtitle = formatDurationLabel(timer.durationMs);
  // Hour-scale readouts ("1:00:00") carry 7-8 glyphs against M:SS's 4-5; at the
  // full digit size they overflow the card's inner width, so the size steps
  // down whenever hours are on the clock.
  const readout = timer.state === "done" ? "0:00" : formatRemaining(remaining);
  const hasHours = readout.split(":").length === 3;
  const digitSize = hero ? (hasHours ? 72 : 112) : hasHours ? 44 : 56;

  const digitStyle = (color: string): CSSProperties => ({
    fontSize: digitSize,
    fontWeight: 200,
    letterSpacing: "-0.03em",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
    color,
    textAlign: "center",
  });

  // ── ringing: accent-filled card, big Stop ──
  if (ringing) {
    return (
      <section
        data-testid={`timer-card-${timer.id}`}
        aria-label={`${title} ringing`}
        style={{
          position: "relative",
          borderRadius: CARD_RADIUS,
          background: "var(--acc)",
          boxShadow: "var(--acc-glow)",
          padding: hero ? "44px 44px 40px" : "26px 24px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: hero ? 22 : 16,
        }}
      >
        <span
          style={{
            fontSize: hero ? 15 : 13,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "rgba(0, 0, 0, 0.65)",
          }}
        >
          {title} · {subtitle} — done
        </span>
        <span style={digitStyle("var(--bg)")}>{readout}</span>
        <Button
          type="button"
          onClick={() => onStopRinging(timer.id)}
          style={{
            height: hero ? 56 : 48,
            maxWidth: hero ? 240 : 180,
            borderRadius: 14,
            background: "var(--bg)",
            color: "var(--ink)",
            fontSize: hero ? 17 : 15,
          }}
        >
          Stop
        </Button>
      </section>
    );
  }

  const running = timer.state === "running";
  const paused = timer.state === "paused";
  const doneSilenced = timer.state === "done" && timer.dismissedCue;
  const inFinalWindow = running && remaining > 0 && remaining <= FINAL_ACCENT_MS;
  const digitColor = inFinalWindow
    ? "var(--acc)"
    : running
      ? "var(--ink)"
      : paused
        ? "var(--ink-2)"
        : "var(--ink-3)";

  return (
    <section
      data-testid={`timer-card-${timer.id}`}
      aria-label={title}
      style={{
        position: "relative",
        borderRadius: CARD_RADIUS,
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        padding: hero ? "36px 40px 32px" : "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: hero ? 26 : 16,
      }}
    >
      {!doneSilenced && (
        <BorderProgressRing
          progress={fraction}
          strokeWidth={RING_STROKE}
          color={running ? "var(--acc)" : "var(--ink-3)"}
          trackColor="var(--hair)"
          radius={CARD_RADIUS}
          data-testid={`timer-ring-${timer.id}`}
        />
      )}

      {/* Header: label + original duration left, X right. */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              fontSize: hero ? 16 : 14,
              fontWeight: 600,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: hero ? 12 : 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {doneSilenced ? `${subtitle} — done` : subtitle}
          </span>
        </div>
        <CornerX
          label={`${doneSilenced ? "Dismiss" : "Delete"} ${title}`}
          onPress={() => (doneSilenced ? onDismiss(timer.id) : onDelete(timer.id))}
        />
      </div>

      <span style={digitStyle(digitColor)}>{readout}</span>

      {/* Action row. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        {running && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onPause(timer.id)}
            style={{ height: 44, maxWidth: hero ? 220 : 160 }}
          >
            Pause
          </Button>
        )}
        {paused && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onResume(timer.id)}
            style={{ height: 44, maxWidth: hero ? 220 : 160 }}
          >
            Resume
          </Button>
        )}
        {doneSilenced && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onRestart(timer.id)}
            style={{ height: 44, maxWidth: hero ? 220 : 160 }}
          >
            Restart
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── new-timer entry ──────────────────────────────────────────────────────────

/** Preset durations (minutes-scale), 44 px targets, Apple's quick-start set. */
const PRESETS: { label: string; ms: number }[] = [
  { label: "1 min", ms: 60_000 },
  { label: "3 min", ms: 3 * 60_000 },
  { label: "5 min", ms: 5 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "15 min", ms: 15 * 60_000 },
  { label: "30 min", ms: 30 * 60_000 },
  { label: "45 min", ms: 45 * 60_000 },
  { label: "1 hr", ms: 60 * 60_000 },
];

const HOURS: WheelPickerValue<number>[] = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: String(h),
}));
const SIXTY: WheelPickerValue<number>[] = Array.from({ length: 60 }, (_, n) => ({
  value: n,
  label: pad2(n),
}));

function PresetButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      style={{
        minHeight: 44,
        borderRadius: 12,
        border: "1px solid var(--hair-2)",
        background: "transparent",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        fontSize: 14,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function WheelColumn({
  caption,
  values,
  value,
  onChange,
  label,
}: {
  caption: string;
  values: readonly WheelPickerValue<number>[];
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {caption}
      </span>
      <WheelPicker values={values} value={value} onChange={onChange} label={label} width={76} />
    </div>
  );
}

/** Preset grid + H/M/S wheels + Start. `centered` is the empty-state layout
 *  (wide, presets in 4 columns); otherwise it is the right rail. */
function NewTimerPanel({ onAdd, centered }: { onAdd: (ms: number) => void; centered: boolean }) {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;

  return (
    <div
      style={{
        width: centered ? 480 : 320,
        flexShrink: 0,
        borderRadius: CARD_RADIUS,
        border: "1px solid var(--hair)",
        padding: centered ? "28px 28px 24px" : "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        New Timer
      </span>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${centered ? 4 : 2}, 1fr)`,
          gap: 10,
        }}
      >
        {PRESETS.map((p) => (
          <PresetButton key={p.label} label={p.label} onPress={() => onAdd(p.ms)} />
        ))}
      </div>

      <div className="divider" />

      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        <WheelColumn caption="hr" values={HOURS} value={hours} onChange={setHours} label="Hours" />
        <WheelColumn
          caption="min"
          values={SIXTY}
          value={minutes}
          onChange={setMinutes}
          label="Minutes"
        />
        <WheelColumn
          caption="sec"
          values={SIXTY}
          value={seconds}
          onChange={setSeconds}
          label="Seconds"
        />
      </div>

      <Button
        type="button"
        disabled={totalMs === 0}
        onClick={() => onAdd(totalMs)}
        style={{ height: 48, borderRadius: 14 }}
      >
        Start
      </Button>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockTimerView({ timers, nowMs, onAdd, ...cardCallbacks }: ClockTimerViewProps) {
  const count = timers.length;

  // Empty state: presets centered, quiet line.
  if (count === 0) {
    return (
      <div
        style={{
          maxWidth: 920,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 22,
          paddingTop: 28,
        }}
      >
        <span style={{ fontSize: 15, color: "var(--ink-3)" }}>No timers running</span>
        <NewTimerPanel onAdd={onAdd} centered />
      </div>
    );
  }

  const cards =
    count === 1 && timers[0] !== undefined ? (
      // Hero: one centered flagship card.
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <div style={{ width: 480, maxWidth: "100%" }}>
          <TimerCard timer={timers[0]} nowMs={nowMs} size="hero" {...cardCallbacks} />
        </div>
      </div>
    ) : (
      // 2-4: two-column grid; >4: the same grid scrolls (host page is fixed).
      <div
        data-testid="timer-card-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 18,
          alignItems: "start",
          ...(count > 4 ? { maxHeight: 760, overflowY: "auto", paddingRight: 4 } : undefined),
        }}
      >
        {timers.map((t) => (
          <TimerCard key={t.id} timer={t} nowMs={nowMs} size="grid" {...cardCallbacks} />
        ))}
      </div>
    );

  return (
    <div style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 26, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>{cards}</div>
        <NewTimerPanel onAdd={onAdd} centered={false} />
      </div>
    </div>
  );
}
