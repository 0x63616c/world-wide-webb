/**
 * DatePicker , standalone dumb presentational date picker (calendar grid + a
 * relative-shortcut rail). Date-only: it selects a calendar day, never a time.
 *
 * Zero trpc/data/hook dependencies; all state driven by props. Selection is a
 * local start-of-day `Date`; `onChange` emits the same. Callers that persist an
 * ISO string convert at their edge , this primitive stays timezone-agnostic and
 * fully exercisable in Storybook/tests.
 *
 * Shape mirrors the "Calendar + presets block" from the picker survey: a rail
 * of relative shortcuts (Today, Tomorrow, ...) beside a month grid.
 */

import { useMemo, useState } from "react";

const DOW = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export interface DatePickerProps {
  /** Selected day (local). `null` renders with nothing highlighted. */
  value: Date | null;
  /** Fires with the picked day at local start-of-day. */
  onChange: (next: Date) => void;
  /** Accessible group name. */
  label: string;
  /**
   * "Today" for the presets + the today marker. Defaults to now; injectable so
   * Storybook/tests are deterministic.
   */
  referenceDate?: Date;
}

/** Local start-of-day clone , strips any time component. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Next occurrence of weekday `target` (0=Sun) strictly after `from`. */
function nextWeekday(from: Date, target: number): Date {
  const diff = (target - from.getDay() + 7) % 7 || 7;
  return addDays(from, diff);
}

interface Preset {
  label: string;
  resolve: (today: Date) => Date;
}

const PRESETS: readonly Preset[] = [
  { label: "Today", resolve: (t) => t },
  { label: "Tomorrow", resolve: (t) => addDays(t, 1) },
  { label: "This weekend", resolve: (t) => nextWeekday(t, 6) },
  { label: "Next week", resolve: (t) => addDays(t, 7) },
  { label: "In 2 weeks", resolve: (t) => addDays(t, 14) },
];

/** 42-cell (6-week) month matrix, leading/trailing days flagged as outside. */
function monthCells(view: Date): { date: Date; outside: boolean }[] {
  const firstDow = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const gridStart = new Date(view.getFullYear(), view.getMonth(), 1 - firstDow);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    return { date, outside: date.getMonth() !== view.getMonth() };
  });
}

const railButtonStyle: React.CSSProperties = {
  fontFamily: "var(--ui)",
  fontSize: 12.5,
  textAlign: "left",
  color: "var(--ink-2)",
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: 8,
  padding: "7px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const navButtonStyle: React.CSSProperties = {
  width: 27,
  height: 27,
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  lineHeight: 1,
  background: "transparent",
  border: "1px solid var(--hair)",
  borderRadius: 7,
  color: "var(--ink-2)",
  cursor: "pointer",
};

export function DatePicker({ value, onChange, label, referenceDate }: DatePickerProps) {
  const today = useMemo(() => startOfDay(referenceDate ?? new Date()), [referenceDate]);
  // Which month the grid shows. Follows the selection, else today.
  const [view, setView] = useState(() => startOfDay(value ?? today));

  const cells = useMemo(() => monthCells(view), [view]);

  function pick(date: Date) {
    setView(startOfDay(date));
    onChange(startOfDay(date));
  }

  return (
    <fieldset
      style={{
        display: "flex",
        gap: 12,
        margin: 0,
        minInlineSize: 0,
        padding: 14,
        background: "var(--tile)",
        border: "1px solid var(--hair)",
        borderRadius: 14,
      }}
    >
      {/* Screen-reader group name; visually hidden so the surface stays flush. */}
      <legend
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {label}
      </legend>

      {/* preset rail */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          paddingRight: 12,
          borderRight: "1px solid var(--hair)",
        }}
      >
        {PRESETS.map((preset) => {
          const resolved = preset.resolve(today);
          const active = value !== null && sameDay(resolved, value);
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => pick(resolved)}
              style={{
                ...railButtonStyle,
                background: active ? "var(--nest-2, #202020)" : "transparent",
                color: active ? "var(--ink)" : "var(--ink-2)",
                borderColor: active ? "var(--hair-2)" : "transparent",
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* calendar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              style={navButtonStyle}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              style={navButtonStyle}
            >
              ›
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginTop: 10 }}>
          {DOW.map((d, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday header, index is stable identity
              key={i}
              style={{ textAlign: "center", fontSize: 10, color: "var(--ink-3)" }}
            >
              {d}
            </span>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 1,
            marginTop: 4,
          }}
        >
          {cells.map(({ date, outside }) => {
            const selected = value !== null && sameDay(date, value);
            const isToday = sameDay(date, today);
            return (
              <button
                key={date.toISOString()}
                type="button"
                aria-pressed={selected}
                aria-label={date.toDateString()}
                onClick={() => pick(date)}
                style={{
                  aspectRatio: "1 / 1",
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--mono)",
                  fontSize: 12.5,
                  color: selected ? "#fff" : outside ? "var(--ink-3)" : "var(--ink-2)",
                  opacity: outside && !selected ? 0.4 : 1,
                  background: selected ? "var(--acc)" : "transparent",
                  border: `1px solid ${
                    selected ? "var(--acc)" : isToday ? "var(--hair-2)" : "transparent"
                  }`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
