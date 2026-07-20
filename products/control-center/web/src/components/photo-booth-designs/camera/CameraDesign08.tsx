/**
 * Design 08 , "Confetti": full party mode. A candy-gradient frame, drifting
 * confetti, bouncy rounded controls in pink/purple/lime, and an oversized
 * countdown. Everything is soft, big, and joyful , the maximalist counterpoint
 * to the brutalist concept.
 */

import { Image, Sparkles, Timer, X, Zap, ZapOff } from "lucide-react";
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
import { CameraKeyframes, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

const CONFETTI = ["#ff5ea8", "#7b5bff", "#5be37d", "#ffd43b", "#4db8ff", "#ff8a3d"];

export function CameraDesign08() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("vivid");
  const [mode, setMode] = useState("burst");
  const [countdown, setCountdown] = useState<CountdownOption>(3);
  const [flashOn, setFlashOn] = useState(true);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div
      style={{
        ...panelRoot("linear-gradient(135deg, #ff5ea8 0%, #7b5bff 50%, #4db8ff 100%)"),
        padding: 26,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <CameraKeyframes />
      <ConfettiField />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, zIndex: 2 }}>
        <button type="button" aria-label="Close" style={candyRound("rgba(255,255,255,0.28)")}>
          <X size={26} />
        </button>
        <div
          style={{
            fontSize: 34,
            fontWeight: 700,
            color: "#fff",
            textShadow: "0 3px 0 rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Sparkles size={30} /> Party Cam
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <button
            type="button"
            aria-label="Flash"
            onClick={() => setFlashOn((v) => !v)}
            style={candyRound(flashOn ? "#ffd43b" : "rgba(255,255,255,0.28)")}
          >
            {flashOn ? <Zap size={24} color="#7b3f00" /> : <ZapOff size={24} />}
          </button>
          <button type="button" aria-label="Gallery" style={candyRound("rgba(255,255,255,0.28)")}>
            <Image size={24} />
          </button>
        </div>
      </div>

      {/* Preview */}
      <div style={{ flex: 1, position: "relative", minHeight: 0, zIndex: 2 }}>
        <CameraStage
          preview={preview}
          filterId={filter}
          radius={34}
          style={{
            position: "absolute",
            inset: 0,
            border: "6px solid rgba(255,255,255,0.85)",
            boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
          }}
        >
          {capture.count !== null && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span
                key={capture.count}
                style={{
                  fontSize: 360,
                  fontWeight: 700,
                  color: "#fff",
                  textShadow: "0 0 60px rgba(255,94,168,0.9), 0 10px 0 rgba(0,0,0,0.1)",
                  animation: "pbCountPop 1s ease-out",
                }}
              >
                {capture.count}
              </span>
            </div>
          )}
          <FlashOverlay active={capture.flashing} />
        </CameraStage>
      </div>

      {/* Filters , big candy swatches */}
      <div style={{ display: "flex", gap: 12, justifyContent: "center", zIndex: 2 }}>
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
                gap: 6,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                font: "inherit",
                transform: active ? "translateY(-6px)" : "none",
                transition: "transform 0.15s ease",
              }}
            >
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: f.swatch,
                  border: active ? "4px solid #fff" : "4px solid rgba(255,255,255,0.4)",
                  boxShadow: active ? "0 8px 20px -4px rgba(0,0,0,0.4)" : "none",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: active ? 700 : 500 }}>{f.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom bar , mode + timer + shutter */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, zIndex: 2 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            background: "rgba(255,255,255,0.2)",
            padding: 6,
            borderRadius: 999,
          }}
        >
          {CAMERA_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={m.disabled}
              onClick={() => !m.disabled && setMode(m.id)}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "none",
                cursor: m.disabled ? "default" : "pointer",
                fontSize: 15,
                fontWeight: 700,
                font: "inherit",
                background: m.id === mode ? "#fff" : "transparent",
                color: m.disabled ? "rgba(255,255,255,0.45)" : m.id === mode ? "#7b5bff" : "#fff",
              }}
            >
              {m.label}
              {m.disabled ? " 🔒" : ""}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            const idx = COUNTDOWN_OPTIONS.indexOf(countdown);
            setCountdown(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
          }}
          aria-label="Timer"
          style={{
            ...candyRound(countdown !== 0 ? "#5be37d" : "rgba(255,255,255,0.28)"),
            width: "auto",
            padding: "0 20px",
            gap: 8,
            height: 56,
          }}
        >
          <Timer size={22} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 17, fontWeight: 700 }}>
            {countdownLabel(countdown)}
          </span>
        </button>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          onClick={capture.shoot}
          aria-label="Shutter"
          style={{
            height: 84,
            padding: "0 44px",
            borderRadius: 999,
            border: "5px solid #fff",
            background: "linear-gradient(135deg, #ff5ea8, #ff8a3d)",
            color: "#fff",
            fontSize: 26,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 12px 30px -8px rgba(0,0,0,0.5)",
            transform: capture.capturing ? "scale(0.94)" : "scale(1)",
            transition: "transform 0.12s ease",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          Snap!
        </button>
      </div>
    </div>
  );
}

function ConfettiField() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: 28 }, (_, i) => {
        // Deterministic scatter so the field is stable across renders.
        const left = (i * 37) % 100;
        const delay = (i % 7) * 0.6;
        const dur = 4 + (i % 5);
        const size = 8 + (i % 4) * 3;
        const color = CONFETTI[i % CONFETTI.length];
        const round = i % 2 === 0;
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative confetti field.
            key={i}
            style={{
              position: "absolute",
              top: -30,
              left: `${left}%`,
              width: size,
              height: size,
              background: color,
              borderRadius: round ? "50%" : 2,
              animation: `pbConfettiFall ${dur}s linear ${delay}s infinite`,
            }}
          />
        );
      })}
    </div>
  );
}

function candyRound(bg: string): React.CSSProperties {
  return {
    height: 56,
    minWidth: 56,
    borderRadius: "50%",
    border: "none",
    background: bg,
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
