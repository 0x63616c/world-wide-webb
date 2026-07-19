/**
 * SettingsButton , the gear pinned to the board's bottom-right corner. Owns the
 * open/close state for the full-page Settings overlay, which always opens behind
 * an always-on PIN gate: gear tap → PinGateModal → success → SettingsPage.
 *
 * The full-screen overlays launched from inside Settings (level, clean screen)
 * are hosted here rather than in SettingsPage: both close the page behind them
 * while open, so exiting one re-opens Settings rather than dumping you on the
 * board (no second PIN gate , you already passed it to get here).
 */

import { useEffect, useState } from "react";
import { consumePendingSettingsPage, usePendingSettingsPage } from "../lib/open-settings-store";
import { CleanScreenOverlay } from "./CleanScreenOverlay";
import { Icon } from "./Icon";
import { LevelOverlay } from "./LevelOverlay";
import { PinGateModal } from "./pin/PinGateModal";
import type { PageKey } from "./settings-page/pages";
import { SettingsPage } from "./settings-page/SettingsPage";

export function SettingsButton() {
  // Gate the page behind the PIN: the gear opens the gate; a correct entry
  // hands off to the page. Two flags so the gate can close before the page
  // mounts (no double overlay flash).
  const [gateOpen, setGateOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  // A deep link's target page, remembered across the gate so the page lands on
  // it after the PIN. Null for a plain gear tap (opens on Device).
  const [requestedPage, setRequestedPage] = useState<PageKey | null>(null);
  // Full-screen overlays launched from the page. Hosted here, not inside
  // SettingsPage: they close the page behind them, and re-open it on exit.
  const [levelOpen, setLevelOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);

  // A tile (the Frontend Logs tile) can request Settings open on a specific
  // page. Route it through the SAME PIN gate as the gear , Settings is gated
  // however it is reached , then land on the requested page.
  const pending = usePendingSettingsPage();
  useEffect(() => {
    if (pending === null) return;
    const page = consumePendingSettingsPage();
    if (page === null) return;
    setRequestedPage(page);
    setGateOpen(true);
  }, [pending]);

  return (
    <>
      <button
        type="button"
        aria-label="Settings"
        onClick={() => {
          // A plain gear tap opens on Device , clear any stale deep-link target.
          setRequestedPage(null);
          setGateOpen(true);
        }}
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
        onClose={() => {
          // A cancelled deep link must not leak into the next plain open.
          setGateOpen(false);
          setRequestedPage(null);
        }}
        onSuccess={() => {
          setGateOpen(false);
          setPageOpen(true);
        }}
      />
      <SettingsPage
        open={pageOpen}
        initialPage={requestedPage ?? undefined}
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
      <LevelOverlay
        open={levelOpen}
        onClose={() => {
          setLevelOpen(false);
          setPageOpen(true);
        }}
      />
      <CleanScreenOverlay
        open={cleanOpen}
        onClose={() => {
          setCleanOpen(false);
          setPageOpen(true);
        }}
      />
    </>
  );
}
