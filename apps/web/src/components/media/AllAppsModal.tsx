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

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
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
        </div>

        {filtered.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
              padding: "20px 0",
            }}
          >
            No apps match "{query}"
          </div>
        )}
      </div>
    </Modal>
  );
}
