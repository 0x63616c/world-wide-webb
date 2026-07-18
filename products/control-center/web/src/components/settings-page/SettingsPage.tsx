/**
 * SettingsPage , the full-page (1366x1024) Settings overlay that replaces the
 * old settings modal. A body-portal fixed overlay (same pattern as the modal /
 * LevelOverlay) laid out per approved Concept A: a 340px tinted-chip sidebar
 * owning page selection, and a scrolling content column that renders the active
 * page component.
 *
 * Page bodies live in `pages/` and register into `PAGE_COMPONENTS` below; a
 * missing key renders nothing (later tasks fill every key). All page components
 * share `PageProps` so the shell can pass its close/overlay callbacks through.
 */

import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { interaction } from "../../lib/log/interaction";
import { registerOpenModal } from "../../lib/modal-open-store";
import { Icon } from "../Icon";
import { BackButton, PageHeader } from "./blocks";
import { PAGE_BY_KEY, PAGES, type PageKey } from "./pages";
import { AboutPage } from "./pages/AboutPage";
import { BoardPage } from "./pages/BoardPage";
import { DebugPage } from "./pages/DebugPage";
import { DevicePage } from "./pages/DevicePage";
import { DisplayPage } from "./pages/DisplayPage";
import { NetworkPage } from "./pages/NetworkPage";
import { NotificationsPage } from "./pages/NotificationsPage";

export type PageProps = {
  onClose: () => void;
  onOpenLevel: () => void;
  onOpenClean: () => void;
};

/**
 * The active-page component registry. Empty for now , page tasks slot their
 * component in under its key. A key with no entry renders nothing.
 */
const PAGE_COMPONENTS: Partial<Record<PageKey, ComponentType<PageProps>>> = {
  device: DevicePage,
  display: DisplayPage,
  board: BoardPage,
  network: NetworkPage,
  notifications: NotificationsPage,
  debug: DebugPage,
  about: AboutPage,
};

export function SettingsPage({
  open,
  onClose,
  onOpenLevel,
  onOpenClean,
}: {
  open: boolean;
  onClose: () => void;
  onOpenLevel: () => void;
  onOpenClean: () => void;
}) {
  const [page, setPage] = useState<PageKey>("device");

  // Reset to the first page whenever the overlay closes, so reopening always
  // lands on Device rather than wherever the last visit left off.
  useEffect(() => {
    if (!open) setPage("device");
  }, [open]);

  // Freeze the board's pan for the overlay's lifetime and let the board's idle
  // reset dismiss it. Ref-routed so a fresh onClose closure never re-registers.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return registerOpenModal(() => onCloseRef.current());
  }, [open]);

  // Interaction log for the open/close lifecycle, mirroring Modal.tsx.
  useEffect(() => {
    if (!open) return;
    const target = "modal.Settings full page";
    interaction("modal", "open", target);
    return () => interaction("modal", "close", target);
  }, [open]);

  // Escape-to-close, only while open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const active = PAGE_BY_KEY[page];
  const ActivePage = PAGE_COMPONENTS[page];

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: 340,
          flexShrink: 0,
          borderRight: "1px solid var(--hair)",
          background: "var(--tile)",
          display: "flex",
          flexDirection: "column",
          padding: 24,
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BackButton onClick={onClose} />
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Settings</h1>
        </div>
        <nav
          style={{ display: "flex", flexDirection: "column", gap: 4 }}
          aria-label="Settings pages"
        >
          {PAGES.map((p) => {
            const selected = p.key === page;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPage(p.key)}
                aria-current={selected ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "10px 12px",
                  background: selected ? "var(--nest)" : "transparent",
                  border: selected ? "1px solid var(--hair-2)" : "1px solid transparent",
                  borderRadius: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: p.tint,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name={p.icon} s={19} sw={2} />
                </span>
                <span
                  style={{ fontFamily: "var(--ui)", fontSize: 16, color: "var(--ink)", flex: 1 }}
                >
                  {p.label}
                </span>
                <span style={{ color: "var(--ink-3)" }}>
                  <Icon name="chevron" s={16} />
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "40px 64px" }}>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 28,
          }}
        >
          <PageHeader title={active.label} blurb={active.blurb} />
          {ActivePage ? (
            <ActivePage onClose={onClose} onOpenLevel={onOpenLevel} onOpenClean={onOpenClean} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
