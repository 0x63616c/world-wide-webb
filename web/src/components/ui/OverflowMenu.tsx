/**
 * OverflowMenu — a "…" button that opens a small popover of row actions.
 *
 * Built for the wall panel: no hover affordance, so the trigger is always
 * visible and sized as a real tap target. The popover closes on outside tap,
 * on Escape, and after any item is chosen. Items are plain data so callers
 * stay declarative; `tone: "danger"` colours destructive actions.
 */

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface OverflowMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  tone?: "default" | "danger";
}

export interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** Accessible name for the trigger, e.g. "Reading actions". */
  label: string;
}

/** Height of one item plus the popover's own padding — enough to decide which
 *  way to open before the popover has been measured. */
const ITEM_H = 40;
const PAD = 10;

export function OverflowMenu({ items, label }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          // Open upward when the popover wouldn't fit below the trigger, so a
          // row near the bottom of the page doesn't get its menu clipped.
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect) {
            const needed = items.length * ITEM_H + PAD;
            setDropUp(window.innerHeight - rect.bottom < needed && rect.top > needed);
          }
          setOpen((v) => !v);
        }}
        style={{
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          background: open ? "var(--nest-2, var(--nest))" : "transparent",
          border: `1px solid ${open ? "var(--hair-2)" : "transparent"}`,
          borderRadius: 10,
          color: "var(--ink-3)",
          cursor: "pointer",
        }}
      >
        {/* An SVG, not a "…" glyph — the text ellipsis sits on the baseline and
            reads as bottom-aligned inside a square button. */}
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
          <circle cx="3.5" cy="9" r="1.5" />
          <circle cx="9" cy="9" r="1.5" />
          <circle cx="14.5" cy="9" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          style={{
            position: "absolute",
            ...(dropUp ? { bottom: 44 } : { top: 44 }),
            right: 0,
            zIndex: 10,
            minWidth: 190,
            padding: 5,
            background: "var(--nest)",
            border: "1px solid var(--hair-2)",
            borderRadius: 12,
            boxShadow: "0 14px 34px -10px rgba(0,0,0,0.7)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                background: "transparent",
                border: "none",
                borderRadius: 8,
                color: item.tone === "danger" ? "var(--red)" : "var(--ink)",
                fontFamily: "var(--ui)",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
