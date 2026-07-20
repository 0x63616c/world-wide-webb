/**
 * Aperture V2D , "Strip". A control-strip take on Aperture.
 *   • Timer , a Timer-glyph button that drops a compact vertical menu (Off /
 *     1s / 3s / 5s / 10s, check on the active row). The glyph carries the
 *     chosen value; it never shows a bare word.
 *   • Filters , a "Filter" pill slides a right-docked vertical strip of swatch
 *     rows in from the panel edge; the trigger shows the active filter name.
 *   • Gallery uses the house control-cell look and the cluster lifts off the
 *     bottom edge.
 */

import { Check } from "lucide-react";
import { useState } from "react";
import { Icon } from "../../Icon";
import {
  FlashButton,
  filterById,
  GalleryButton,
  glassBtn,
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

export function ApertureV2D() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const capture = useCapture({ countdown, flashOn });
  const active = filterById(filter);

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
            zIndex: 32,
          }}
        >
          <TopClose />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FlashButton on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
            {/* Timer glyph button + vertical dropdown menu. */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setTimerOpen((v) => !v)}
                aria-label={`Self-timer ${countdownLabel(countdown)}`}
                aria-haspopup="menu"
                aria-expanded={timerOpen}
                style={{
                  ...glassBtn(countdown !== 0, true),
                  width: "auto",
                  minWidth: 48,
                  padding: countdown === 0 ? 0 : "0 16px 0 14px",
                  gap: 7,
                }}
              >
                <Icon name="timer" s={20} />
                {countdown !== 0 && (
                  <span style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
                    {countdownLabel(countdown)}
                  </span>
                )}
              </button>
              {timerOpen && (
                <div
                  role="menu"
                  aria-label="Self-timer"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    right: 0,
                    width: 150,
                    ...glassPanel(),
                    padding: 8,
                    animation: "pbDrop 0.16s ease-out",
                  }}
                >
                  <style>{`@keyframes pbDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
                  {COUNTDOWN_OPTIONS.map((s) => {
                    const on = s === countdown;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="menuitemradio"
                        aria-checked={on}
                        onClick={() => {
                          setCountdown(s);
                          setTimerOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          width: "100%",
                          padding: "9px 10px",
                          borderRadius: 9,
                          border: "none",
                          cursor: "pointer",
                          background: on ? "var(--acc-dim)" : "transparent",
                          color: on ? "var(--acc)" : "var(--ink)",
                          fontFamily: "var(--mono)",
                          fontSize: 14.5,
                          fontWeight: on ? 600 : 500,
                          textAlign: "left",
                        }}
                      >
                        <span style={{ flex: 1 }}>{s === 0 ? "Off" : `${s}s`}</span>
                        {on && <Check size={16} strokeWidth={2.5} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
          }}
        >
          {/* Filters trigger , opens the right-docked strip. */}
          <button
            type="button"
            onClick={() => setStripOpen(true)}
            aria-label="Filters"
            aria-haspopup="dialog"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 16px",
              ...glassPanel(),
              borderRadius: 999,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            <Swatch filter={active} active={false} size={18} />
            <span style={{ color: "var(--ink-2)" }}>Filter</span>
            <span style={{ fontWeight: 600 }}>{active.label}</span>
          </button>

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

        {/* Right-docked filter strip. */}
        {stripOpen && (
          <>
            <MenuScrim onClose={() => setStripOpen(false)} />
            <div
              role="dialog"
              aria-label="Choose filter"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: 0,
                zIndex: 31,
                width: 220,
                ...glassPanel(),
                borderRadius: "22px 0 0 22px",
                padding: "26px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                animation: "pbSlideIn 0.24s cubic-bezier(0.16,1,0.3,1)",
              }}
            >
              <style>{`@keyframes pbSlideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
              <div style={{ padding: "0 6px 10px" }}>{menuCap("Filters")}</div>
              {CAMERA_FILTERS.map((f) => {
                const on = f.id === filter;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFilter(f.id);
                      setStripOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      padding: "9px 8px",
                      borderRadius: 12,
                      border: "none",
                      cursor: "pointer",
                      background: on ? "var(--acc-dim)" : "transparent",
                      color: on ? "var(--acc)" : "var(--ink)",
                      fontFamily: "var(--ui)",
                      fontSize: 15,
                      fontWeight: on ? 600 : 500,
                      textAlign: "left",
                    }}
                  >
                    <Swatch filter={f} active={on} size={30} />
                    <span style={{ flex: 1 }}>{f.label}</span>
                    {on && <Check size={17} strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {timerOpen && <MenuScrim onClose={() => setTimerOpen(false)} />}
        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}
