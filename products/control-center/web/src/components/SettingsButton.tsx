/**
 * SettingsButton , the gear pinned to the board's bottom-right corner. Owns the
 * open/close state for the settings modal and renders SettingsPanel inside the
 * shared Modal. Replaces the old temporary SnapModeSwitcher slot; the snap-mode
 * control now lives inside the panel alongside the idle-dim + FPS settings.
 */

import { useState } from "react";
import { Icon } from "./Icon";
import { SettingsPanel } from "./SettingsPanel";
import { Modal } from "./ui/Modal";

export function SettingsButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          // The overlay layer is pointer-events:none; opt this control back in.
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          padding: 0,
          background: "rgba(12, 14, 17, 0.92)",
          border: "1px solid var(--hair-2)",
          borderRadius: 8,
          color: "var(--ink-2)",
          cursor: "pointer",
        }}
      >
        <Icon name="settings" s={18} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Settings"
        width={460}
        maxHeight={640}
        scrollbar="visible"
      >
        <SettingsPanel />
      </Modal>
    </>
  );
}
