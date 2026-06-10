/**
 * AllAppsModal — searchable grid of all Apple TV apps (www-51hf.22 / A27).
 *
 * Renders the real source_list apps from the tvApps query. The currently-open
 * app is marked with an accent ring. Search filters the grid in real time.
 * Tapping an app launches it via the tvLaunchApp mutation.
 *
 * Built from shared ui primitives (A17): Modal.
 */

import { useState } from "react";
import { Modal } from "@/components/ui";
import { TvAppMark, tvAppsInOrder } from "./tv-app-logos";

// ── Grid geometry (www-cb57) ──────────────────────────────────────────────────
// The grid lives in a pinned-height viewport (4 columns × 5.5 rows — the half
// row signals scrollability) so filtering never resizes the modal. Underfull
// results are padded with placeholder cells up to a full 6 rows, so the grid
// stays visually full even with zero matches.

const GRID_COLS = 4;
const GRID_GAP = 10;
// 12px padding + 48px logo + 6px gap + ~14px label + 12px padding.
const CELL_H = 92;
const VISIBLE_ROWS = 5.5;
const VIEWPORT_H = VISIBLE_ROWS * CELL_H + Math.floor(VISIBLE_ROWS) * GRID_GAP;
const MIN_CELLS = GRID_COLS * Math.ceil(VISIBLE_ROWS);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AllAppsModalProps {
  open: boolean;
  onClose: () => void;
  apps: string[];
  currentApp: string | null;
  onLaunchApp: (app: string) => void;
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function AllAppsModal({ open, onClose, apps, currentApp, onLaunchApp }: AllAppsModalProps) {
  const [query, setQuery] = useState("");

  // Favorites first, then logo apps, then glyph-only — same order as the tile.
  const ordered = tvAppsInOrder(apps);
  const filtered = query.trim()
    ? ordered.filter((a) => a.toLowerCase().includes(query.toLowerCase()))
    : ordered;

  return (
    <Modal open={open} onClose={onClose} title="All Apps" width={560} maxHeight={760}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Search */}
        <input
          type="text"
          aria-label="Search apps"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            background: "var(--tile-2)",
            border: "1px solid var(--tile-3)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "var(--ink-1)",
            fontSize: 14,
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
          }}
        />

        {/* Grid — pinned-height scroll viewport so filtering never resizes
            the modal; modal-scroll hides the scrollbar (kiosk style). */}
        <div
          data-testid="apps-grid-viewport"
          className="modal-scroll"
          style={{ height: VIEWPORT_H, overflowY: "auto" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
              gridAutoRows: CELL_H,
              gap: GRID_GAP,
            }}
          >
            {filtered.map((app) => {
              const isActive = app === currentApp;
              return (
                <button
                  key={app}
                  type="button"
                  data-active-app={isActive ? "true" : undefined}
                  aria-label={`Launch ${app}`}
                  onClick={() => {
                    onLaunchApp(app);
                    onClose();
                  }}
                  style={{
                    padding: "12px 8px",
                    borderRadius: 12,
                    border: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                    background: "var(--tile-2)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {/* Full-color brand mark (or 2-letter monospace glyph fallback) */}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "var(--tile-3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    <TvAppMark name={app} size={34} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: isActive ? "var(--accent)" : "var(--ink-2)",
                      textAlign: "center",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                    }}
                  >
                    {app}
                  </span>
                </button>
              );
            })}

            {/* Placeholder cells keep the grid visually full when results
                underfill the viewport (including zero matches). */}
            {Array.from({ length: Math.max(0, MIN_CELLS - filtered.length) }, (_, i) => (
              <div
                // Cells are interchangeable blanks; position is identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: static decorative fillers
                key={i}
                data-testid="app-placeholder"
                aria-hidden="true"
                style={{
                  borderRadius: 12,
                  background: "var(--tile-2)",
                  opacity: 0.35,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
