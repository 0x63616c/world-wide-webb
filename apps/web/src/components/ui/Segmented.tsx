/**
 * Segmented , standalone dumb presentational segmented control (single-select
 * row of connected equal-width cells). Zero trpc/data/hook dependencies; all
 * state driven by props. Used where a handful of mutually-exclusive options
 * should read as one control rather than a loose row of chips.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible group name. */
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{
        display: "flex",
        width: "100%",
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 10,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: radio-in-radiogroup is the correct ARIA pattern for a styled segmented control; native inputs can't carry the connected-cell styling.
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "7px 4px",
              border: "none",
              borderRadius: 8,
              background: active ? "var(--acc)" : "transparent",
              color: active ? "var(--bg)" : "var(--ink-2)",
              font: "inherit",
              fontFamily: "var(--ui)",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              letterSpacing: "-0.01em",
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
