/**
 * Design 05 , "Aurora Glass": glassmorphism. The preview runs full-bleed under
 * an aurora wash; every control floats in a frosted, blurred glass panel with a
 * hairline highlight. A single glass dock at the bottom carries the filter pills,
 * the ring shutter, and the mode switch. Soft, weightless, modern.
 */

import { Image, Timer, X, Zap, ZapOff } from "lucide-react";
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
import { CameraKeyframes, CountdownOverlay, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

const glass: React.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  border: "1px solid rgba(255,255,255,0.22)",
  backdropFilter: "blur(22px) saturate(1.3)",
  WebkitBackdropFilter: "blur(22px) saturate(1.3)",
  boxShadow: "0 10px 40px -12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.3)",
};

export function CameraDesign05() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("cool");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div style={panelRoot("#05060a")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        {/* Aurora wash */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(60% 50% at 15% 10%, rgba(0,112,243,0.28), transparent 60%), radial-gradient(55% 45% at 90% 20%, rgba(111,219,203,0.24), transparent 60%), radial-gradient(70% 60% at 60% 110%, rgba(180,90,255,0.26), transparent 60%)",
          }}
        />

        {/* Top-left close */}
        <button
          type="button"
          aria-label="Close"
          style={{
            ...glass,
            position: "absolute",
            top: 28,
            left: 28,
            width: 52,
            height: 52,
            borderRadius: "50%",
            color: "#fff",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <X size={24} />
        </button>

        {/* Top-right flash + timer */}
        <div
          style={{
            ...glass,
            position: "absolute",
            top: 28,
            right: 28,
            borderRadius: 26,
            padding: 8,
            display: "flex",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setFlashOn((v) => !v)}
            aria-label="Flash"
            style={ghostRound(flashOn)}
          >
            {flashOn ? <Zap size={22} /> : <ZapOff size={22} />}
          </button>
          <button
            type="button"
            onClick={() => {
              const idx = COUNTDOWN_OPTIONS.indexOf(countdown);
              setCountdown(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
            }}
            aria-label="Timer"
            style={{ ...ghostRound(countdown !== 0), width: "auto", padding: "0 16px", gap: 7 }}
          >
            <Timer size={20} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 15 }}>
              {countdownLabel(countdown)}
            </span>
          </button>
        </div>

        <CountdownOverlay count={capture.count} />

        {/* Bottom dock */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 40,
            transform: "translateX(-50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
            width: "min(880px, 88%)",
          }}
        >
          {/* Filter pills */}
          <div
            style={{
              ...glass,
              borderRadius: 999,
              padding: 8,
              display: "flex",
              gap: 6,
            }}
          >
            {CAMERA_FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: active ? "rgba(255,255,255,0.9)" : "transparent",
                    color: active ? "#0a0a0a" : "rgba(255,255,255,0.85)",
                    font: "inherit",
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    transition: "background 0.15s ease, color 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: f.swatch,
                      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
                    }}
                  />
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Shutter + mode row */}
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <button
              type="button"
              aria-label="Gallery"
              style={{
                ...glass,
                width: 60,
                height: 60,
                borderRadius: 18,
                color: "#fff",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Image size={24} />
            </button>

            <button
              type="button"
              onClick={capture.shoot}
              aria-label="Shutter"
              style={{
                width: 92,
                height: 92,
                borderRadius: "50%",
                border: "3px solid rgba(255,255,255,0.7)",
                background: "rgba(255,255,255,0.16)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                boxShadow: "0 0 40px -6px rgba(255,255,255,0.5)",
              }}
            >
              <span
                style={{
                  width: 66,
                  height: 66,
                  borderRadius: "50%",
                  background: "#fff",
                  transform: capture.capturing ? "scale(0.8)" : "scale(1)",
                  transition: "transform 0.12s ease",
                }}
              />
            </button>

            <div
              style={{
                ...glass,
                borderRadius: 999,
                padding: 6,
                display: "flex",
                gap: 4,
              }}
            >
              {CAMERA_MODES.map((m) => {
                const active = m.id === mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.disabled}
                    onClick={() => !m.disabled && setMode(m.id)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      border: "none",
                      cursor: m.disabled ? "default" : "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      font: "inherit",
                      background: active ? "rgba(0,112,243,0.85)" : "transparent",
                      color: m.disabled
                        ? "rgba(255,255,255,0.32)"
                        : active
                          ? "#fff"
                          : "rgba(255,255,255,0.8)",
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

function ghostRound(active: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: "50%",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    background: active ? "rgba(255,255,255,0.9)" : "transparent",
    color: active ? "#0a0a0a" : "#fff",
    transition: "background 0.15s ease, color 0.15s ease",
  };
}
