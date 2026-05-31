/**
 * Modal — dumb presentational overlay + centered fixed-size panel.
 * Zero trpc/data/hook dependencies beyond local effect for Escape; all visible
 * state is driven by props so it can be exercised in isolation/Storybook.
 *
 * Sized for the fixed 1366x1024 wall panel: the panel is a fixed dialog size
 * (not responsive/fluid) and the overlay covers the whole board.
 */

import type { ReactNode } from "react";
import { useEffect } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Stable id so the dialog can be aria-labelledby its own title node.
const TITLE_ID = "modal-title";

export function Modal({ open, onClose, title, children }: ModalProps) {
  // Escape-to-close. Listener is only attached while open so a background
  // (closed) modal never swallows Escape meant for something else.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Outer layer centers the panel over a full-viewport dim field. It holds no
    // click handler itself — the backdrop is a real <button> sibling beneath the
    // panel, so dismissal is keyboard-accessible and clicks inside the panel
    // simply never reach the backdrop (no stopPropagation gymnastics needed).
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop: a button so click-to-dismiss is genuinely interactive and
          focusable. aria-hidden + tabIndex -1 keep it out of the tab/AT order;
          Escape and the visible Close button are the announced affordances. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="modal-backdrop"
        className="modal-backdrop"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          padding: 0,
          cursor: "default",
          background: "rgba(0, 0, 0, 0.55)",
        }}
      />

      {/* Centered fixed-size panel, layered above the backdrop. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="modal-panel"
        style={{
          position: "relative",
          width: 640,
          maxHeight: 720,
          display: "flex",
          flexDirection: "column",
          background: "var(--tile)",
          color: "var(--ink)",
          border: "1px solid var(--hair)",
          borderRadius: "var(--r)",
          boxShadow: "0 24px 64px -16px rgba(0, 0, 0, 0.7)",
          fontFamily: "var(--ui)",
          overflow: "hidden",
        }}
      >
        {/* Header: title left, close button right. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 20,
            borderBottom: "1px solid var(--hair)",
          }}
        >
          <h2
            id={TITLE_ID}
            style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              padding: 0,
              cursor: "pointer",
              color: "var(--ink-2)",
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              font: "inherit",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            {/* × glyph; aria-label carries the accessible name. */}
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {/* Scrollable body — uniform padding matches the header scale.
            .modal-scroll only hides the scrollbar; sizing comes from the panel
            (flex:1), so the body stays within the 640px panel width. */}
        <div className="modal-scroll" style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
