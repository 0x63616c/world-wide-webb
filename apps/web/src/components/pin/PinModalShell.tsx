/**
 * PinModalShell , the body-portal overlay every PIN surface sits in: backdrop,
 * centred dialog, Escape-to-close, modal-open registration, interaction log.
 *
 * Extracted from PinGateModal when the change-PIN flow moved onto its own
 * surface (#298) and needed the identical container. The parts that must not
 * drift between the two , registering in the global modal count (which freezes
 * board pan and lets the idle reset dismiss us) , now have one implementation
 * rather than two copies.
 */

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEscapeToClose } from "../../lib/escape-stack";
import { registerOpenModal } from "../../lib/modal-open-store";
import { Z_LAYER } from "../../lib/z-layers";

export function PinModalShell({
  open,
  label,
  backdropTestId,
  onClose,
  children,
}: {
  open: boolean;
  /** The dialog's accessible name. The visible title changes per stage, so
   *  naming the SURFACE is the stable choice. */
  label: string;
  backdropTestId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Register in the global modal-open count while open. Routed through a ref so
  // a fresh onClose each render never re-registers , copied from ui/Modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    return registerOpenModal(() => onCloseRef.current());
  }, [open]);

  // Escape-to-close, arbitrated so ONLY the topmost surface closes. A dialog
  // opened over Settings must not take Settings down with it (#298).
  useEscapeToClose(open, () => onCloseRef.current());

  if (!open) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z_LAYER.pinDialog,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop: a button so click-to-dismiss is genuinely interactive and
          focusable. aria-hidden + tabIndex -1 keep it out of the tab/AT order;
          Escape and the visible Cancel button are the announced affordances. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        data-testid={backdropTestId}
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

      {/* Centred card , the approved PinUnlockModalConcept dialog. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: "relative",
          background: "var(--tile)",
          border: "1px solid var(--hair)",
          borderRadius: "var(--r)",
          boxShadow: "0 24px 64px -16px rgba(0, 0, 0, 0.7)",
          width: 720,
          padding: "48px 40px 44px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          color: "var(--ink)",
          fontFamily: "var(--ui)",
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The dialog's lock/unlock chip + title + sub-line stack. Shared so the gate
 *  and the change flow read as the same surface at a glance. */
export function PinModalHeader({
  icon,
  title,
  sub,
  error,
  good,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  /** Paints the sub-line red (wrong PIN, mismatch) rather than muted. */
  error?: boolean;
  /** Tints the chip green , the one success beat each surface has. */
  good?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "var(--nest)",
          border: "1px solid var(--hair)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: good ? "#43a56c" : "var(--ink-2)",
          marginBottom: 6,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, color: error ? "#c95c5c" : "var(--ink-3)" }}>{sub}</div>
    </div>
  );
}

/** The dialog's plain-text dismiss, under the pad. */
export function PinModalCancel({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color: "var(--ink-3)",
        fontFamily: "var(--ui)",
        fontSize: 14,
        cursor: "pointer",
        padding: 4,
      }}
    >
      Cancel
    </button>
  );
}
