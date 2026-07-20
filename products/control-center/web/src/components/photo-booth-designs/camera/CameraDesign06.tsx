/**
 * Design 06 , "Reel": a cinematic filmstrip. The preview sits in a letterboxed
 * frame; filters live on a real 35mm filmstrip rail down the right edge, each a
 * sprocket-holed frame you scroll through. Controls read like a film camera ,
 * mono readouts, a red record-style shutter, and a slate-style mode row.
 */

import { Film, Timer, X, Zap, ZapOff } from "lucide-react";
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

const AMBER = "#f4c063";

export function CameraDesign06() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("mono");
  const [mode, setMode] = useState("gif");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div
      style={{
        ...panelRoot("#0b0b0d"),
        display: "flex",
      }}
    >
      <CameraKeyframes />

      {/* Left , preview + controls */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <CameraStage
            preview={preview}
            filterId={filter}
            style={{ position: "absolute", inset: 0 }}
          >
            {/* Letterbox bars */}
            <div aria-hidden style={cineBar("top")} />
            <div aria-hidden style={cineBar("bottom")} />

            <button
              type="button"
              aria-label="Close"
              style={{
                position: "absolute",
                top: 24,
                left: 24,
                width: 46,
                height: 46,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.5)",
                color: "#fff",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              <X size={22} />
            </button>

            {/* Slate readout top-right */}
            <div
              style={{
                position: "absolute",
                top: 24,
                right: 24,
                fontFamily: "var(--mono)",
                fontSize: 13,
                color: AMBER,
                textAlign: "right",
                lineHeight: 1.5,
                textShadow: "0 1px 4px #000",
              }}
            >
              <div>SCENE 01 · TAKE 03</div>
              <div style={{ color: "rgba(255,255,255,0.7)" }}>
                {CAMERA_FILTERS.find((f) => f.id === filter)?.label.toUpperCase()} · 24FPS
              </div>
            </div>

            <CountdownOverlay count={capture.count} color={AMBER} />
            <FlashOverlay active={capture.flashing} />
          </CameraStage>
        </div>

        {/* Control deck */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "#121214",
            padding: "18px 28px",
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Mode slate */}
          <div style={{ display: "flex", gap: 8 }}>
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => !m.disabled && setMode(m.id)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: `1px solid ${m.id === mode ? AMBER : "rgba(255,255,255,0.14)"}`,
                  background: m.id === mode ? "rgba(244,192,99,0.14)" : "transparent",
                  color: m.disabled ? "rgba(255,255,255,0.3)" : m.id === mode ? AMBER : "#c9c9c9",
                  fontFamily: "var(--mono)",
                  fontSize: 13,
                  cursor: m.disabled ? "default" : "pointer",
                }}
              >
                {m.label.toUpperCase()}
                {m.disabled ? " ○" : ""}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => setFlashOn((v) => !v)}
            aria-label="Flash"
            style={deckBtn(flashOn)}
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
            style={{ ...deckBtn(countdown !== 0), width: "auto", padding: "0 16px", gap: 8 }}
          >
            <Timer size={18} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 14 }}>
              {countdownLabel(countdown)}
            </span>
          </button>

          {/* Record shutter */}
          <button
            type="button"
            onClick={capture.shoot}
            aria-label="Shutter"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.35)",
              background: "#0b0b0d",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <span
              style={{
                width: capture.capturing ? 22 : 40,
                height: capture.capturing ? 22 : 40,
                borderRadius: capture.capturing ? 5 : "50%",
                background: "#e63b3b",
                transition: "all 0.14s ease",
              }}
            />
          </button>
        </div>
      </div>

      {/* Right , filmstrip rail */}
      <div
        style={{
          width: 168,
          background: "#050506",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 0 10px",
            textAlign: "center",
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.2em",
            color: "rgba(255,255,255,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Film size={14} /> FILM
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "6px 0 16px",
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
                  position: "relative",
                  margin: "0 14px",
                  height: 92,
                  borderRadius: 4,
                  border: active ? `2px solid ${AMBER}` : "2px solid transparent",
                  background: `linear-gradient(135deg, ${f.swatch}, #1a1a1a)`,
                  cursor: "pointer",
                  overflow: "hidden",
                  boxShadow: active ? "0 0 20px -4px rgba(244,192,99,0.6)" : "none",
                }}
              >
                {/* sprocket holes */}
                <SprocketColumn side="left" />
                <SprocketColumn side="right" />
                <span
                  style={{
                    position: "absolute",
                    bottom: 6,
                    left: 0,
                    right: 0,
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "#fff",
                    textShadow: "0 1px 3px #000",
                  }}
                >
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function cineBar(edge: "top" | "bottom"): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    [edge]: 0,
    height: 64,
    background: `linear-gradient(${edge === "top" ? "180deg" : "0deg"}, #000, transparent)`,
    pointerEvents: "none",
  };
}

function deckBtn(active: boolean): React.CSSProperties {
  return {
    height: 46,
    minWidth: 46,
    borderRadius: 10,
    border: `1px solid ${active ? AMBER : "rgba(255,255,255,0.16)"}`,
    background: active ? "rgba(244,192,99,0.14)" : "transparent",
    color: active ? AMBER : "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function SprocketColumn({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [side]: 3,
        width: 6,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-around",
        padding: "6px 0",
      }}
    >
      {Array.from({ length: 4 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative sprocket holes.
          key={i}
          style={{ width: 6, height: 8, borderRadius: 1, background: "rgba(0,0,0,0.7)" }}
        />
      ))}
    </span>
  );
}
