/**
 * PhotoGrid , the shared gallery grid behind both the photo booth and Activity.
 *
 * The look originated in BoothGallery ("Minimal Squares"): an edge-to-edge
 * uniform square grid under oversized bold date headers. It lives here so the
 * two galleries share it by construction rather than by copied constants , a
 * change to the cell size or header weight lands on both at once.
 *
 * Deliberately NOT included: the lightbox. The booth opens one; Activity
 * navigates to the owning session instead. Overlay behaviour stays with the
 * caller, and everything inside a cell comes from the `renderCell` slot, so
 * this component owns layout and nothing else.
 *
 * Purely presentational and generic over the item type , callers pre-group into
 * days (the booth by capture time, Activity by the listing's UTC day buckets).
 */

import type { CSSProperties, ReactNode } from "react";

/** One dated section of the grid. */
export interface PhotoGridDay<T> {
  /** Stable react key for the section. */
  key: string | number;
  /** Heading text ("Today", "Yesterday", "Fri 18 Jul", "2026-07-18"). */
  label: string;
  /** Shown muted beside the heading , usually the item count. */
  count: ReactNode;
  items: T[];
}

export interface PhotoGridProps<T> {
  days: PhotoGridDay<T>[];
  /** Stable react key for one cell. */
  itemKey: (item: T) => string;
  /** The cell's pixels (an <img>, a 2x2 composite, …). */
  renderCell: (item: T) => ReactNode;
  /** Accessible label for the cell button. */
  cellLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /**
   * Cells that cannot be opened , rendered dimmed and non-interactive rather
   * than silently swallowing a tap. Defaults to everything being selectable.
   */
  isDisabled?: (item: T) => boolean;
  /** Overlaid on top of the cell's pixels (mode dots, timestamps). */
  renderOverlay?: (item: T) => ReactNode;
  /** Shown in place of the sections when there is nothing to show. */
  empty?: ReactNode;
}

export function PhotoGrid<T>({
  days,
  itemKey,
  renderCell,
  cellLabel,
  onSelect,
  isDisabled,
  renderOverlay,
  empty,
}: PhotoGridProps<T>) {
  if (days.length === 0) return <>{empty ?? null}</>;

  return (
    <>
      {days.map((day) => (
        <section key={day.key}>
          <h2 style={dateHeader}>
            {day.label}
            <span style={dateHeaderCount}>{day.count}</span>
          </h2>
          <div style={grid}>
            {day.items.map((item) => {
              const disabled = isDisabled?.(item) ?? false;
              return (
                <button
                  key={itemKey(item)}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(item)}
                  style={disabled ? disabledCell : cell}
                  aria-label={cellLabel(item)}
                >
                  {renderCell(item)}
                  {renderOverlay?.(item)}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

// ---- styles ----------------------------------------------------------------
// Verbatim from BoothGallery so adopting this is a visual no-op there.

const dateHeader: CSSProperties = {
  margin: 0,
  padding: "26px 24px 14px",
  fontSize: 34,
  fontWeight: 800,
  letterSpacing: "-0.03em",
};

const dateHeaderCount: CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  color: "var(--ink-3)",
  marginLeft: 12,
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(8, 1fr)",
  gap: 2,
};

const cell: CSSProperties = {
  position: "relative",
  aspectRatio: "1 / 1",
  padding: 0,
  border: "none",
  background: "var(--nest)",
  cursor: "pointer",
  overflow: "hidden",
};

/** A cell with nothing to open , dimmed so the grid tells the truth. */
const disabledCell: CSSProperties = {
  ...cell,
  cursor: "default",
  opacity: 0.45,
};
