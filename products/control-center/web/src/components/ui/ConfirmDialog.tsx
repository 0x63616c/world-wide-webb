/**
 * ConfirmDialog , a small "are you sure?" gate built on Modal.
 *
 * For destructive or otherwise irreversible actions (reset settings, delete):
 * a titled prompt with a Cancel / Confirm pair, Confirm tinted red in the
 * `danger` tone. Presentational , open/close and the two callbacks are driven
 * by the caller so it can be exercised in Storybook. Buttons are inline rather
 * than borrowed from the settings-page blocks, so this `ui/` primitive stays
 * free of any page-module dependency.
 */

import type { ReactNode } from "react";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  /** `danger` tints Confirm red for destructive actions. */
  tone?: "default" | "danger";
}

const BUTTON_BASE = {
  height: 40,
  padding: "0 18px",
  borderRadius: 10,
  fontFamily: "var(--ui)",
  fontSize: 14,
  cursor: "pointer",
} as const;

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
  tone = "default",
}: ConfirmDialogProps) {
  const danger = tone === "danger";
  return (
    <Modal open={open} onClose={onClose} title={title} width={420} minHeight={200}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          height: "100%",
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, color: "var(--ink-2)", fontFamily: "var(--ui)", fontSize: 15 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...BUTTON_BASE,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              color: "var(--ink-1)",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              ...BUTTON_BASE,
              background: danger ? "rgb(var(--red-rgb) / 0.14)" : "var(--acc-dim)",
              border: `1px solid ${danger ? "rgb(var(--red-rgb) / 0.4)" : "var(--acc-line)"}`,
              color: danger ? "var(--red)" : "var(--acc)",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
