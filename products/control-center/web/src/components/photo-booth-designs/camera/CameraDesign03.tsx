/**
 * Design 03 , "Instant": the preview lives inside a tilted Polaroid with the
 * classic fat bottom border and a handwritten caption. It sits on a warm paper
 * desk with a washi-tape control tray , pastel film-swatch filters and a
 * camera-body red shutter. Playful and tactile.
 */

import { Images, Timer, X, Zap, ZapOff } from "lucide-react";
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

const INK = "#3a3226";

export function CameraDesign03() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("warm");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div
      style={{
        ...panelRoot(
          "radial-gradient(120% 120% at 30% 10%, #f3e7d0 0%, #e7d5b6 60%, #dcc7a2 100%)",
        ),
        color: INK,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CameraKeyframes />

      <button
        type="button"
        aria-label="Close"
        style={{
          position: "absolute",
          top: 30,
          left: 30,
          width: 46,
          height: 46,
          borderRadius: "50%",
          border: "none",
          background: "rgba(58,50,38,0.08)",
          color: INK,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        <X size={24} />
      </button>

      {/* Polaroid */}
      <div
        style={{
          transform: capture.capturing ? "rotate(-1deg) scale(1.01)" : "rotate(-2deg)",
          transition: "transform 0.2s ease",
          background: "#fffdf8",
          padding: "22px 22px 74px",
          borderRadius: 6,
          boxShadow: "0 30px 60px -20px rgba(58,50,38,0.5), 0 2px 0 rgba(0,0,0,0.05)",
          position: "relative",
        }}
      >
        {/* Washi tape */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -14,
            left: "50%",
            transform: "translateX(-50%) rotate(-3deg)",
            width: 130,
            height: 34,
            background: "rgba(111,219,203,0.55)",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          }}
        />
        <CameraStage
          preview={preview}
          filterId={filter}
          radius={2}
          style={{ width: 560, height: 560 }}
        >
          <CountdownOverlay count={capture.count} />
          <FlashOverlay active={capture.flashing} />
        </CameraStage>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 22,
            textAlign: "center",
            fontFamily: "var(--mono)",
            fontSize: 20,
            color: INK,
            opacity: 0.7,
          }}
        >
          the wall · {CAMERA_FILTERS.find((f) => f.id === filter)?.label.toLowerCase()}
        </div>
      </div>

      {/* Control tray */}
      <div
        style={{
          position: "absolute",
          right: 40,
          top: "50%",
          transform: "translateY(-50%)",
          width: 250,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background: "#fffdf8",
          border: "1px solid rgba(58,50,38,0.12)",
          borderRadius: 18,
          padding: 20,
          boxShadow: "0 20px 40px -24px rgba(58,50,38,0.5)",
        }}
      >
        <TrayLabel>Film</TrayLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {CAMERA_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-label={f.label}
              style={{
                width: 44,
                height: 56,
                borderRadius: 4,
                border: f.id === filter ? "2px solid #e05a4a" : "2px solid rgba(58,50,38,0.15)",
                background: `linear-gradient(180deg, ${f.swatch}, #fffdf8)`,
                cursor: "pointer",
                position: "relative",
                boxShadow: f.id === filter ? "0 4px 10px -4px rgba(224,90,74,0.6)" : "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  bottom: 3,
                  left: 0,
                  right: 0,
                  fontSize: 8,
                  fontFamily: "var(--mono)",
                  color: INK,
                }}
              >
                {f.label}
              </span>
            </button>
          ))}
        </div>

        <TrayLabel>Mode</TrayLabel>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CAMERA_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={m.disabled}
              onClick={() => !m.disabled && setMode(m.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "none",
                fontFamily: "var(--ui)",
                fontSize: 13,
                fontWeight: 600,
                cursor: m.disabled ? "default" : "pointer",
                background:
                  m.id === mode
                    ? "#e05a4a"
                    : m.disabled
                      ? "rgba(58,50,38,0.06)"
                      : "rgba(58,50,38,0.1)",
                color: m.disabled ? "rgba(58,50,38,0.35)" : m.id === mode ? "#fff" : INK,
              }}
            >
              {m.label}
              {m.disabled ? " · soon" : ""}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={() => setFlashOn((v) => !v)}
            aria-label="Flash"
            style={roundTray(flashOn)}
          >
            {flashOn ? <Zap size={20} /> : <ZapOff size={20} />}
          </button>
          <button
            type="button"
            onClick={() => {
              const idx = COUNTDOWN_OPTIONS.indexOf(countdown);
              setCountdown(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
            }}
            aria-label="Timer"
            style={{ ...roundTray(countdown !== 0), width: "auto", padding: "0 14px", gap: 6 }}
          >
            <Timer size={18} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
              {countdownLabel(countdown)}
            </span>
          </button>
          <button type="button" aria-label="Gallery" style={roundTray(false)}>
            <Images size={20} />
          </button>
        </div>

        {/* Shutter , camera body button */}
        <button
          type="button"
          onClick={capture.shoot}
          style={{
            marginTop: 4,
            height: 60,
            borderRadius: 14,
            border: "none",
            background: "linear-gradient(180deg, #4a4038, #322b24)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            fontFamily: "var(--ui)",
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: capture.capturing ? "#ff8a7a" : "#e05a4a",
              boxShadow: "0 0 0 3px rgba(255,255,255,0.15)",
              transition: "background 0.1s ease",
            }}
          />
          Snap
        </button>
      </div>
    </div>
  );
}

function TrayLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "rgba(58,50,38,0.55)",
      }}
    >
      {children}
    </div>
  );
}

function roundTray(active: boolean): React.CSSProperties {
  return {
    height: 44,
    width: 44,
    borderRadius: "50%",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    background: active ? "#f4c063" : "rgba(58,50,38,0.1)",
    color: "#3a3226",
  };
}
