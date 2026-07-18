/**
 * SettingsButton , the gear pinned to the board's bottom-right corner. Owns the
 * open/close state for the full-page Settings overlay, which always opens behind
 * an always-on PIN gate: gear tap → PinGateModal → success → SettingsPage.
 *
 * The full-screen overlays launched from inside Settings (level, clean screen)
 * are hosted here rather than in SettingsPage: both close the page behind them
 * (Tesla-style, you land back on the board), which unmounts the page.
 */

import { useState } from "react";
import { CleanScreenOverlay } from "./CleanScreenOverlay";
import { Icon } from "./Icon";
import { LevelOverlay } from "./LevelOverlay";
import { PinGateModal } from "./pin/PinGateModal";
import { SettingsPage } from "./settings-page/SettingsPage";

export function SettingsButton() {
  // Gate the page behind the PIN: the gear opens the gate; a correct entry
  // hands off to the page. Two flags so the gate can close before the page
  // mounts (no double overlay flash).
  const [gateOpen, setGateOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  // Full-screen overlays launched from the page. Hosted here, not inside
  // SettingsPage: both close the page behind them (Tesla-style, you land back
  // on the board), which unmounts the page.
  const [levelOpen, setLevelOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={() => setGateOpen(true)}
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
      <PinGateModal
        open={gateOpen}
        title="Settings"
        onClose={() => setGateOpen(false)}
        onSuccess={() => {
          setGateOpen(false);
          setPageOpen(true);
        }}
      />
      <SettingsPage
        open={pageOpen}
        onClose={() => setPageOpen(false)}
        onOpenLevel={() => {
          setPageOpen(false);
          setLevelOpen(true);
        }}
        onOpenClean={() => {
          setPageOpen(false);
          setCleanOpen(true);
        }}
      />
      <LevelOverlay open={levelOpen} onClose={() => setLevelOpen(false)} />
      <CleanScreenOverlay open={cleanOpen} onClose={() => setCleanOpen(false)} />
    </>
  );
}
