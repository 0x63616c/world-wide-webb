/**
 * Design 07 , "Dial": rotary control surface. A big tick-marked dial is anchored
 * off the bottom edge; the filters ride its rim like a camera's mode wheel and
 * the shutter is the dial's hub. Countdown is a second small rotary, mode and
 * flash are satellite keys. Mechanical and tactile.
 */

import { Image, X, Zap, ZapOff } from "lucide-react";
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

const ACC = "#0070f3";
const DIAL = 620;
const RIM_R = 250;

export function CameraDesign07() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("vivid");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(3);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  const arc = 150; // total sweep of the filter rim, degrees
  const start = -arc / 2;

  return (
    <div style={panelRoot("#060708")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(0deg, rgba(6,7,8,0.9) 0%, transparent 42%)",
            pointerEvents: "none",
          }}
        />

        {/* Top bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            padding: "28px 34px",
          }}
        >
          <button type="button" aria-label="Close" style={satKey(false)}>
            <X size={24} />
          </button>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => setFlashOn((v) => !v)}
              aria-label="Flash"
              style={satKey(flashOn)}
            >
              {flashOn ? <Zap size={22} /> : <ZapOff size={22} />}
            </button>
            <button type="button" aria-label="Gallery" style={satKey(false)}>
              <Image size={22} />
            </button>
          </div>
        </div>

        {/* Mode strip */}
        <div
          style={{
            position: "absolute",
            top: 96,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 8,
            background: "rgba(0,0,0,0.4)",
            borderRadius: 999,
            padding: 6,
            border: "1px solid var(--hair)",
          }}
        >
          {CAMERA_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={m.disabled}
              onClick={() => !m.disabled && setMode(m.id)}
              style={{
                padding: "8px 16px",
                borderRadius: 999,
                border: "none",
                cursor: m.disabled ? "default" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                font: "inherit",
                background: m.id === mode ? ACC : "transparent",
                color: m.disabled ? "rgba(255,255,255,0.3)" : m.id === mode ? "#fff" : "#c9c9c9",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        <CountdownOverlay count={capture.count} color={ACC} />

        {/* Countdown mini-rotary, left */}
        <div
          style={{
            position: "absolute",
            left: 60,
            bottom: 120,
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.5)",
            border: "1px solid var(--hair-2)",
            display: "grid",
            placeItems: "center",
          }}
        >
          {COUNTDOWN_OPTIONS.map((c, i) => {
            const angle = -140 + (i * 280) / (COUNTDOWN_OPTIONS.length - 1);
            const active = c === countdown;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCountdown(c)}
                aria-label={`Timer ${countdownLabel(c)}`}
                style={{
                  position: "absolute",
                  transform: `rotate(${angle}deg) translateY(-44px) rotate(${-angle}deg)`,
                  width: 30,
                  height: 22,
                  borderRadius: 6,
                  border: "none",
                  background: active ? ACC : "transparent",
                  color: active ? "#fff" : "var(--ink-2)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {c === 0 ? "off" : c}
              </button>
            );
          })}
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)" }}>
            TIMER
          </span>
        </div>

        {/* Main dial */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: -DIAL / 2 + 190,
            width: DIAL,
            height: DIAL,
            marginLeft: -DIAL / 2,
            borderRadius: "50%",
            background: "radial-gradient(circle at 50% 40%, #1c1e22, #0a0b0d 70%)",
            border: "1px solid var(--hair-2)",
            boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.8), inset 0 2px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* tick marks */}
          {Array.from({ length: 48 }, (_, i) => {
            const a = (i * 360) / 48;
            return (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative tick ring.
                key={i}
                aria-hidden
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 2,
                  height: i % 4 === 0 ? 14 : 8,
                  background: "rgba(255,255,255,0.18)",
                  transformOrigin: "center top",
                  transform: `rotate(${a}deg) translateY(${DIAL / 2 - 22}px)`,
                }}
              />
            );
          })}

          {/* pointer */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: "50%",
              top: 8,
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: `16px solid ${ACC}`,
            }}
          />

          {/* filter rim */}
          {CAMERA_FILTERS.map((f, i) => {
            const angle = start + (i * arc) / (CAMERA_FILTERS.length - 1);
            const active = f.id === filter;
            const rad = (angle * Math.PI) / 180;
            const cx = DIAL / 2 + RIM_R * Math.sin(rad);
            const cy = DIAL / 2 - RIM_R * Math.cos(rad);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-label={f.label}
                style={{
                  position: "absolute",
                  left: cx,
                  top: cy,
                  transform: "translate(-50%, -50%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: active ? "#fff" : "var(--ink-2)",
                  font: "inherit",
                }}
              >
                <span
                  style={{
                    width: active ? 34 : 26,
                    height: active ? 34 : 26,
                    borderRadius: "50%",
                    background: f.swatch,
                    boxShadow: active
                      ? `0 0 0 3px #0a0b0d, 0 0 0 5px ${ACC}`
                      : "inset 0 0 0 1px rgba(255,255,255,0.2)",
                    transition: "all 0.15s ease",
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{f.label}</span>
              </button>
            );
          })}

          {/* hub shutter */}
          <button
            type="button"
            onClick={capture.shoot}
            aria-label="Shutter"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: `translate(-50%, -50%) scale(${capture.capturing ? 0.9 : 1})`,
              width: 128,
              height: 128,
              borderRadius: "50%",
              border: "4px solid rgba(255,255,255,0.85)",
              background: `radial-gradient(circle at 50% 35%, #2a2c31, #101115)`,
              color: "#fff",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              transition: "transform 0.12s ease",
              boxShadow: `0 0 40px -8px ${ACC}`,
            }}
          >
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: `inset 0 0 0 4px #101115`,
              }}
            />
          </button>
        </div>

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

function satKey(active: boolean): React.CSSProperties {
  return {
    width: 50,
    height: 50,
    borderRadius: "50%",
    border: "1px solid var(--hair-2)",
    background: active ? ACC : "rgba(0,0,0,0.45)",
    color: "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  };
}
