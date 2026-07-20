/**
 * Aperture V2B , "Pillbox". Every control is a pill.
 *   • Timer , a single cycling pill button led by a Timer glyph; tapping it
 *     steps Off → 1s → 3s → 5s → 10s → Off (iOS-style), so it never shows a
 *     bare word and always reads as a self-timer.
 *   • Filters , the swatch ramp collapses into a "Filter" pill whose label is
 *     the active filter; tapping it raises a compact popover card (a vertical
 *     swatch list with a check on the active row) anchored above the trigger.
 *   • Gallery adopts the house control-cell look and the cluster lifts off the
 *     bottom edge.
 */

import { Check, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Icon } from "../../Icon";
import {
  FlashButton,
  filterById,
  GalleryButton,
  glassPanel,
  MenuScrim,
  menuCap,
  Scrim,
  Swatch,
  TopClose,
} from "./apertureV2-kit";
import { CameraStage } from "./CameraStage";
import {
  CAMERA_FILTERS,
  CAMERA_MODES,
  COUNTDOWN_OPTIONS,
  type CountdownOption,
  countdownLabel,
  useCapture,
} from "./camera-shared";
import { CameraKeyframes, CountdownOverlay, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

export function ApertureV2B() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const capture = useCapture({ countdown, flashOn });
  const active = filterById(filter);

  const cycleTimer = () => {
    const idx = COUNTDOWN_OPTIONS.indexOf(countdown);
    setCountdown(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
  };

  return (
    <div style={panelRoot("#000")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        <Scrim edge="top" />
        <Scrim edge="bottom" />

        {/* Top bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "26px 34px",
          }}
        >
          <TopClose />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FlashButton on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
            {/* Single cycling timer pill. */}
            <button
              type="button"
              onClick={cycleTimer}
              aria-label={`Self-timer ${countdownLabel(countdown)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                height: 48,
                padding: "0 18px",
                ...glassPanel(),
                borderRadius: 999,
                cursor: "pointer",
                background: countdown === 0 ? "rgba(12,12,12,0.82)" : "var(--amber)",
                color: countdown === 0 ? "var(--ink)" : "#1a1206",
                borderColor: countdown === 0 ? "var(--hair-2)" : "transparent",
              }}
            >
              <Icon name="timer" s={19} />
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 15,
                  minWidth: 30,
                  textAlign: "center",
                }}
              >
                {countdownLabel(countdown)}
              </span>
            </button>
          </div>
        </div>

        <CountdownOverlay count={capture.count} />

        {/* Bottom cluster , lifted off the bottom edge. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "0 0 62px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 26,
            zIndex: 31,
          }}
        >
          {/* Filter trigger + anchored popover card. */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Filter"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 16px",
                ...glassPanel(),
                borderRadius: 999,
                cursor: "pointer",
                fontSize: 14,
                borderColor: menuOpen ? "var(--acc-line)" : "var(--hair-2)",
              }}
            >
              <SlidersHorizontal size={17} strokeWidth={2} />
              <span style={{ color: "var(--ink-2)" }}>Filter</span>
              <Swatch filter={active} active={false} size={18} />
              <span style={{ fontWeight: 600 }}>{active.label}</span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="Filters"
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 12px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 31,
                  width: 240,
                  ...glassPanel(),
                  padding: "12px 12px 14px",
                  animation: "pbPop 0.16s ease-out",
                }}
              >
                <style>{`@keyframes pbPop{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
                <div style={{ padding: "2px 6px 8px" }}>{menuCap("Filters")}</div>
                {CAMERA_FILTERS.map((f) => {
                  const on = f.id === filter;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      onClick={() => {
                        setFilter(f.id);
                        setMenuOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        padding: "9px 8px",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        background: on ? "var(--acc-dim)" : "transparent",
                        color: on ? "var(--acc)" : "var(--ink)",
                        fontFamily: "var(--ui)",
                        fontSize: 14.5,
                        fontWeight: on ? 600 : 500,
                        textAlign: "left",
                      }}
                    >
                      <Swatch filter={f} active={false} size={24} />
                      <span style={{ flex: 1 }}>{f.label}</span>
                      {on && <Check size={17} strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Shutter row */}
          <div
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              padding: "0 60px",
            }}
          >
            <div style={{ justifySelf: "start" }}>
              <GalleryButton />
            </div>
            <button
              type="button"
              onClick={capture.shoot}
              aria-label="Shutter"
              style={{
                width: 86,
                height: 86,
                borderRadius: "50%",
                border: "5px solid #fff",
                background: "#fff",
                boxShadow: "0 0 0 3px #000",
                cursor: "pointer",
                transform: capture.capturing ? "scale(0.88)" : "scale(1)",
                transition: "transform 0.12s ease",
              }}
            />
            <div style={{ justifySelf: "end" }} />
          </div>

          {/* Mode row , house chips. */}
          <div style={{ display: "flex", gap: 8, width: 620 }}>
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => !m.disabled && setMode(m.id)}
                className={`chip${m.id === mode ? " on" : ""}`}
                style={{ opacity: m.disabled ? 0.4 : 1, textTransform: "uppercase", fontSize: 12 }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {menuOpen && <MenuScrim onClose={() => setMenuOpen(false)} />}
        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}
