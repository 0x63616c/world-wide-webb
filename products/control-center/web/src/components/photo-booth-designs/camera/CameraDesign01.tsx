/**
 * Design 01 , "Aperture": an iOS-Camera-like minimal concept. Edge-to-edge
 * preview, a slim translucent top bar for flash/timer/close, a horizontal
 * filter ramp above a big white ring shutter, and a text mode row underneath.
 * The chrome stays out of the way and lets the picture do the talking.
 */

import { Images, X, Zap, ZapOff } from "lucide-react";
import { useState } from "react";
import { CameraStage } from "./CameraStage";
import {
  CAMERA_FILTERS,
  CAMERA_MODES,
  COUNTDOWN_OPTIONS,
  type CountdownOption,
  countdownLabel,
  useCapture,
} from "./camera-shared";
import { CameraKeyframes, CountdownOverlay, FlashOverlay, iconBtn, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

export function CameraDesign01() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div style={panelRoot("#000")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
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
            background: "linear-gradient(180deg, rgba(0,0,0,0.55), transparent)",
          }}
        >
          <button type="button" style={iconBtn(false)} aria-label="Close">
            <X size={24} />
          </button>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              style={iconBtn(flashOn)}
              onClick={() => setFlashOn((v) => !v)}
              aria-label="Flash"
            >
              {flashOn ? <Zap size={22} /> : <ZapOff size={22} />}
            </button>
            <TimerCycle value={countdown} onChange={setCountdown} />
          </div>
        </div>

        <CountdownOverlay count={capture.count} />

        {/* Bottom control cluster */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "0 0 40px",
            background: "linear-gradient(0deg, rgba(0,0,0,0.62), transparent)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
          }}
        >
          {/* Filter ramp */}
          <div style={{ display: "flex", gap: 10, padding: "22px 34px 0" }}>
            {CAMERA_FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 7,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: active ? "#fff" : "rgba(255,255,255,0.6)",
                    font: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "50%",
                      background: f.swatch,
                      boxShadow: active
                        ? "0 0 0 3px #000, 0 0 0 5px #fff"
                        : "inset 0 0 0 1px rgba(255,255,255,0.2)",
                      transition: "box-shadow 0.15s ease",
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: active ? 600 : 400 }}>{f.label}</span>
                </button>
              );
            })}
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
            <button
              type="button"
              aria-label="Gallery"
              style={{
                justifySelf: "start",
                width: 58,
                height: 58,
                borderRadius: 14,
                border: "2px solid rgba(255,255,255,0.5)",
                background: "linear-gradient(135deg, #3a3f47, #12151a)",
                color: "rgba(255,255,255,0.85)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
              }}
            >
              <Images size={22} />
            </button>

            <button
              type="button"
              onClick={capture.shoot}
              aria-label="Shutter"
              style={{
                width: 84,
                height: 84,
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

          {/* Mode row */}
          <div style={{ display: "flex", gap: 26, fontSize: 14, letterSpacing: "0.04em" }}>
            {CAMERA_MODES.map((m) => {
              const active = m.id === mode;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.disabled}
                  onClick={() => !m.disabled && setMode(m.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: m.disabled ? "default" : "pointer",
                    textTransform: "uppercase",
                    fontWeight: active ? 700 : 500,
                    color: m.disabled
                      ? "rgba(255,255,255,0.28)"
                      : active
                        ? "#f4c063"
                        : "rgba(255,255,255,0.7)",
                    font: "inherit",
                    position: "relative",
                  }}
                >
                  {m.label}
                  {m.disabled && (
                    <span style={{ fontSize: 9, marginLeft: 4, verticalAlign: "super" }}>soon</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

/** Small tappable timer that cycles Off → 1 → 3 → 5 → 10, iOS-style. */
function TimerCycle({
  value,
  onChange,
}: {
  value: CountdownOption;
  onChange: (v: CountdownOption) => void;
}) {
  const next = () => {
    const idx = COUNTDOWN_OPTIONS.indexOf(value);
    onChange(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
  };
  return (
    <button
      type="button"
      onClick={next}
      style={{
        ...iconBtn(value !== 0),
        width: "auto",
        padding: "0 16px",
        fontFamily: "var(--mono)",
        fontSize: 15,
        gap: 6,
      }}
      aria-label="Timer"
    >
      {countdownLabel(value)}
    </button>
  );
}
