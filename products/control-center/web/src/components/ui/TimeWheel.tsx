/**
 * TimeWheel , a touch-first time picker for the fixed 1366x1024 wall panel.
 *
 * Two scroll-snap wheel columns (hours 00–23, minutes 00–59 in `minuteStep`
 * increments) with large 44px rows, a highlighted center row, and fade masks
 * top/bottom so the picker reads as a physical wheel. Fully controlled:
 * `{ value: { h, m }, onChange }`. Rows are real buttons, so a value can be set
 * by TAPPING a row or by scrolling the column to it , both keyboard-reachable
 * and reliable to test. Zero data/hook deps beyond local scroll bookkeeping.
 */

import { useEffect, useRef } from "react";

export interface TimeValue {
  h: number;
  m: number;
}

export interface TimeWheelProps {
  value: TimeValue;
  onChange: (next: TimeValue) => void;
  /**
   * Minute granularity. Minutes run 0..59 in this step (default 5). Pass 1 to
   * preserve arbitrary-minute precision (e.g. replacing a free-text HH:MM field).
   */
  minuteStep?: number;
  disabled?: boolean;
}

const ROW_H = 44;
// Odd row count so exactly one row sits in the middle; the pad above/below lets
// the first and last value scroll to that center line.
const VISIBLE = 5;
const PAD = ((VISIBLE - 1) / 2) * ROW_H;
const COL_H = VISIBLE * ROW_H;

const pad2 = (n: number) => String(n).padStart(2, "0");

function range(count: number, step: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < count; n += step) out.push(n);
  return out;
}

interface ColumnProps {
  label: string;
  values: number[];
  selected: number;
  disabled: boolean;
  onSelect: (v: number) => void;
}

function WheelColumn({ label, values, selected, disabled, onSelect }: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  // True while WE drive scrollTop (to align the controlled value), so the scroll
  // handler ignores those events instead of echoing a redundant onChange.
  const programmatic = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idx = values.indexOf(selected);

  // Align the selected value to the center line whenever it changes externally.
  useEffect(() => {
    const el = ref.current;
    if (!el || idx < 0) return;
    programmatic.current = true;
    el.scrollTop = idx * ROW_H;
    const t = setTimeout(() => {
      programmatic.current = false;
    }, 80);
    return () => clearTimeout(t);
  }, [idx]);

  const onScroll = () => {
    if (programmatic.current) return;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW_H)));
      const v = values[i];
      if (v !== selected) onSelect(v);
    }, 90);
  };

  return (
    <div style={{ position: "relative", width: 76, height: COL_H }}>
      <div
        ref={ref}
        className="timewheel-col"
        role="listbox"
        aria-label={label}
        onScroll={onScroll}
        style={{
          height: "100%",
          overflowY: disabled ? "hidden" : "auto",
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div style={{ height: PAD }} aria-hidden="true" />
        {values.map((v) => {
          const active = v === selected;
          return (
            <button
              key={v}
              type="button"
              role="option"
              aria-selected={active}
              aria-label={`${label} ${pad2(v)}`}
              disabled={disabled}
              onClick={() => onSelect(v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: ROW_H,
                scrollSnapAlign: "center",
                border: "none",
                background: "none",
                cursor: disabled ? "default" : "pointer",
                fontFamily: "var(--mono)",
                fontSize: 24,
                fontWeight: active ? 600 : 400,
                color: active ? "var(--ink)" : "var(--ink-3)",
                opacity: active ? 1 : 0.55,
                transition: "color 0.12s ease, opacity 0.12s ease",
              }}
            >
              {pad2(v)}
            </button>
          );
        })}
        <div style={{ height: PAD }} aria-hidden="true" />
      </div>

      {/* Center highlight band , marks the row the wheel resolves to. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: PAD,
          height: ROW_H,
          borderTop: "1px solid var(--hair)",
          borderBottom: "1px solid var(--hair)",
          pointerEvents: "none",
        }}
      />
      {/* Fade masks , dissolve the rows toward the top and bottom edges. The
          gradient uses the panel colour (--tile) so off-center rows recede. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "linear-gradient(var(--tile), rgba(0,0,0,0) 32%, rgba(0,0,0,0) 68%, var(--tile))",
        }}
      />
    </div>
  );
}

export function TimeWheel({ value, onChange, minuteStep = 5, disabled = false }: TimeWheelProps) {
  const hours = range(24, 1);
  const minutes = range(60, minuteStep);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        userSelect: "none",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <WheelColumn
        label="Hours"
        values={hours}
        selected={value.h}
        disabled={disabled}
        onSelect={(h) => onChange({ h, m: value.m })}
      />
      <span style={{ fontFamily: "var(--mono)", fontSize: 24, color: "var(--ink-3)" }}>:</span>
      <WheelColumn
        label="Minutes"
        values={minutes}
        selected={value.m}
        disabled={disabled}
        onSelect={(m) => onChange({ h: value.h, m })}
      />
    </div>
  );
}

/** Parse "HH:MM" into a TimeValue; tolerates missing/short values. */
export function parseHHMM(time: string): TimeValue {
  const [h, m] = time.split(":");
  return { h: Number(h) || 0, m: Number(m) || 0 };
}

/** Format a TimeValue as zero-padded "HH:MM". */
export function formatHHMM({ h, m }: TimeValue): string {
  return `${pad2(h)}:${pad2(m)}`;
}
