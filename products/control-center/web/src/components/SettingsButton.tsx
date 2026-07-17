/**
 * SettingsButton , the gear pinned to the board's bottom-right corner. Owns the
 * open/close state for the settings modal and renders SettingsPanel inside the
 * shared Modal. Replaces the old temporary SnapModeSwitcher slot; the snap-mode
 * control now lives inside the panel alongside the idle-dim + FPS settings.
 */

import { useState } from "react";
import { CleanScreenOverlay } from "./CleanScreenOverlay";
import { Icon } from "./Icon";
import { LevelOverlay } from "./LevelOverlay";
import { SettingsPanel } from "./SettingsPanel";
import { Modal } from "./ui/Modal";

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  // Full-screen overlays launched from the panel. Hosted here, not inside
  // SettingsPanel: both close the settings modal behind them (Tesla-style,
  // you land back on the board), which unmounts the panel.
  const [levelOpen, setLevelOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          // The overlay layer is pointer-events:none; opt this control back in.
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // 48px clears Apple's 44px minimum touch target , easy to tap on the
          // wall panel without zooming in on the little gear.
          width: 48,
          height: 48,
          padding: 0,
          background: "rgba(12, 14, 17, 0.92)",
          border: "1px solid var(--hair-2)",
          borderRadius: 10,
          color: "var(--ink-2)",
          cursor: "pointer",
        }}
      >
        <Icon name="settings" s={22} />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Settings"
        width={460}
        maxHeight={640}
        scrollbar="visible"
      >
        <SettingsPanel
          onClose={() => setOpen(false)}
          onOpenLevel={() => {
            setOpen(false);
            setLevelOpen(true);
          }}
          onOpenClean={() => {
            setOpen(false);
            setCleanOpen(true);
          }}
        />
      </Modal>
      <LevelOverlay open={levelOpen} onClose={() => setLevelOpen(false)} />
      <CleanScreenOverlay open={cleanOpen} onClose={() => setCleanOpen(false)} />
    </>
  );
}
