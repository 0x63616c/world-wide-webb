/**
 * WheelPicker , the panel's one mechanism for ALL time/duration entry: an
 * on-screen Apple-wheel-like snap-scroll column. TextInput is banned for time
 * entry on the kiosk (a focused field summons the iOS keyboard over the fixed
 * 1366x1024 layout), so the Timer's custom H/M/S entry and the Alarm editor's
 * hour/minute columns both ride this instead of inventing their own.
 *
 * Dumb presentational: `values`/`value`/`onChange`, zero data dependencies.
 * Momentum + snap come from native scrolling with CSS scroll-snap; a short
 * settle debounce commits the row nearest center, and tapping any row selects
 * it directly. Rows are 44 px , the panel's minimum hit target.
 */

import { useCallback, useEffect, useRef } from "react";

/** One selectable row. */
export interface WheelPickerValue<T extends string | number> {
  value: T;
  label: string;
}

export interface WheelPickerProps<T extends string | number> {
  values: readonly WheelPickerValue<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible column name, e.g. "Hours". */
  label: string;
  /** Visible row count (odd, so one row centers). Default 5. */
  visibleRows?: number;
  /** Column width in px. Default 88. */
  width?: number;
}

/** Row height , the panel's 44 px minimum hit target. */
const ROW_PX = 44;
/** How long after the last scroll event the wheel counts as settled. */
const SETTLE_MS = 120;

export function WheelPicker<T extends string | number>({
  values,
  value,
  onChange,
  label,
  visibleRows = 5,
  width = 88,
}: WheelPickerProps<T>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<number>(0);

  const selectedIndex = Math.max(
    0,
    values.findIndex((v) => v.value === value),
  );
  const height = visibleRows * ROW_PX;
  const padY = ((visibleRows - 1) / 2) * ROW_PX;

  // Keep the wheel parked on the selected row whenever `value` changes from
  // outside (preset tap, editor open). Direct scrollTop write , jsdom-safe, and
  // instant so an external change never animates through unrelated rows. The
  // echo scroll event this causes is harmless: the settle commit below no-ops
  // when the nearest row already IS the value, so no suppression flag is needed
  // (a flag would eat the first real scroll in environments where scrollTop
  // writes emit no event).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const target = selectedIndex * ROW_PX;
    if (Math.abs(el.scrollTop - target) < 1) return;
    el.scrollTop = target;
  }, [selectedIndex]);

  const commitNearest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ROW_PX)));
    const next = values[idx];
    if (next !== undefined && next.value !== value) onChange(next.value);
  }, [values, value, onChange]);

  const onScroll = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(commitNearest, SETTLE_MS);
  }, [commitNearest]);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      {/* Center highlight band , marks the committed row. Behind the rows so the
          accent text reads on top of it. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: padY,
          left: 0,
          right: 0,
          height: ROW_PX,
          background: "var(--nest)",
          border: "1px solid var(--hair)",
          borderRadius: 10,
          pointerEvents: "none",
        }}
      />
      <div
        ref={scrollerRef}
        role="listbox"
        aria-label={label}
        onScroll={onScroll}
        style={{
          position: "relative",
          height: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollSnapType: "y mandatory",
          scrollbarWidth: "none",
          // Fade the off-center rows like a real wheel; mask (not a gradient
          // overlay) so it works over any page background.
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 28%, black 72%, transparent)",
          maskImage: "linear-gradient(to bottom, transparent, black 28%, black 72%, transparent)",
        }}
      >
        <div style={{ height: padY }} />
        {values.map((v) => {
          const selected = v.value === value;
          return (
            <button
              key={String(v.value)}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                if (!selected) onChange(v.value);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: ROW_PX,
                scrollSnapAlign: "center",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                font: "inherit",
                fontFamily: "var(--ui)",
                fontSize: selected ? 22 : 17,
                fontWeight: selected ? 600 : 400,
                fontVariantNumeric: "tabular-nums",
                color: selected ? "var(--acc)" : "var(--ink-2)",
                transition: "color 0.12s ease, font-size 0.12s ease",
              }}
            >
              {v.label}
            </button>
          );
        })}
        <div style={{ height: padY }} />
      </div>
    </div>
  );
}
