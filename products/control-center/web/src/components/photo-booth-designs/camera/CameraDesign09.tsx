/**
 * Design 09 , "Pro HUD": a mirrorless-camera viewfinder. Rule-of-thirds grid,
 * corner framing brackets, a centre focus reticle, and mono exposure readouts
 * ringing the frame. Filters read as picture profiles; the shutter is a precise
 * amber key. This is the concept that leans hardest into the app's own
 * mono/amber/accent design language.
 */

import { Aperture, Image, Timer, X, Zap, ZapOff } from "lucide-react";
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
const TEAL = "#6fdbcb";

export function CameraDesign09() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div style={panelRoot("#060708")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        {/* Thirds grid */}
        <ThirdsGrid />
        {/* Corner brackets */}
        <Bracket pos={{ top: 74, left: 40 }} corner="tl" />
        <Bracket pos={{ top: 74, right: 40 }} corner="tr" />
        <Bracket pos={{ bottom: 150, left: 40 }} corner="bl" />
        <Bracket pos={{ bottom: 150, right: 40 }} corner="br" />
        {/* Focus reticle */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 120,
            height: 120,
            border: `1.5px solid ${capture.capturing ? AMBER : TEAL}`,
            borderRadius: 4,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
          }}
        >
          <span style={crosshair("h")} />
          <span style={crosshair("v")} />
        </div>

        {/* Top HUD */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "20px 40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "var(--mono)",
            fontSize: 14,
            color: "#fff",
            background: "linear-gradient(180deg, rgba(0,0,0,0.6), transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <button type="button" aria-label="Close" style={hudKey(false)}>
              <X size={20} />
            </button>
            <Readout k="ISO" v="400" />
            <Readout k="1/" v="125" />
            <Readout k="F" v="2.8" />
            <Readout k="WB" v="AUTO" c={TEAL} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#e63b3b",
                animation: "pbRecBlink 1.4s ease-in-out infinite",
              }}
            />
            <span style={{ color: "#e63b3b", letterSpacing: "0.1em" }}>REC</span>
            <span style={{ marginLeft: 10, color: AMBER }}>[ ▮▮▮▯ ] 74%</span>
          </div>
        </div>

        <CountdownOverlay count={capture.count} color={AMBER} />

        {/* Histogram bottom-left */}
        <div
          style={{
            position: "absolute",
            left: 40,
            bottom: 168,
            width: 150,
            height: 62,
            background: "rgba(0,0,0,0.55)",
            border: "1px solid var(--hair-2)",
            borderRadius: 6,
            padding: 6,
            display: "flex",
            alignItems: "flex-end",
            gap: 2,
          }}
        >
          {HISTOGRAM.map((h, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative histogram bars.
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                background: `linear-gradient(180deg, ${TEAL}, ${AMBER})`,
                opacity: 0.8,
                borderRadius: 1,
              }}
            />
          ))}
        </div>

        {/* Bottom control bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "16px 40px 22px",
            background: "linear-gradient(0deg, rgba(6,7,8,0.94), transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Picture profiles + modes */}
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
                letterSpacing: "0.16em",
              }}
            >
              PROFILE
            </span>
            <div style={{ display: "flex", gap: 8 }}>
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
                      gap: 7,
                      padding: "7px 12px",
                      borderRadius: 6,
                      border: `1px solid ${active ? AMBER : "var(--hair-2)"}`,
                      background: active ? "rgba(244,192,99,0.14)" : "rgba(0,0,0,0.4)",
                      color: active ? AMBER : "#c9c9c9",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{ width: 10, height: 10, borderRadius: 2, background: f.swatch }}
                    />
                    {f.label.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {CAMERA_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.disabled}
                  onClick={() => !m.disabled && setMode(m.id)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: `1px solid ${m.id === mode ? "var(--acc-line)" : "var(--hair)"}`,
                    background: m.id === mode ? "var(--acc-dim)" : "transparent",
                    color: m.disabled ? "var(--ink-3)" : m.id === mode ? "var(--acc)" : "#c9c9c9",
                    fontFamily: "var(--mono)",
                    fontSize: 12,
                    cursor: m.disabled ? "default" : "pointer",
                  }}
                >
                  {m.label.toUpperCase()}
                  {m.disabled ? " ·SOON" : ""}
                </button>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            <button
              type="button"
              onClick={() => setFlashOn((v) => !v)}
              aria-label="Flash"
              style={hudKey(flashOn)}
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
              style={{ ...hudKey(countdown !== 0), width: "auto", padding: "0 14px", gap: 7 }}
            >
              <Timer size={18} />
              <span style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                {countdownLabel(countdown)}
              </span>
            </button>
            <button type="button" aria-label="Gallery" style={hudKey(false)}>
              <Image size={20} />
            </button>

            {/* Shutter */}
            <button
              type="button"
              onClick={capture.shoot}
              aria-label="Shutter"
              style={{
                height: 58,
                padding: "0 26px",
                borderRadius: 10,
                border: "none",
                background: capture.capturing ? "#fff" : AMBER,
                color: "#1a1206",
                fontFamily: "var(--mono)",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.12em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                transition: "background 0.1s ease",
              }}
            >
              <Aperture size={22} />
              REC
            </button>
          </div>
        </div>

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

const HISTOGRAM = [12, 20, 34, 52, 70, 88, 76, 60, 44, 55, 68, 50, 36, 24, 16, 10];

function Readout({ k, v, c = "#fff" }: { k: string; v: string; c?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ color: "var(--ink-3)", fontSize: 11 }}>{k}</span>
      <span style={{ color: c, fontWeight: 700 }}>{v}</span>
    </span>
  );
}

function ThirdsGrid() {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {[33.33, 66.66].map((p) => (
        <span
          key={`v${p}`}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${p}%`,
            width: 1,
            background: "rgba(255,255,255,0.16)",
          }}
        />
      ))}
      {[33.33, 66.66].map((p) => (
        <span
          key={`h${p}`}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${p}%`,
            height: 1,
            background: "rgba(255,255,255,0.16)",
          }}
        />
      ))}
    </div>
  );
}

function Bracket({ pos, corner }: { pos: React.CSSProperties; corner: "tl" | "tr" | "bl" | "br" }) {
  const top = corner[0] === "t";
  const left = corner[1] === "l";
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        width: 34,
        height: 34,
        borderTop: top ? "2px solid rgba(255,255,255,0.7)" : "none",
        borderBottom: !top ? "2px solid rgba(255,255,255,0.7)" : "none",
        borderLeft: left ? "2px solid rgba(255,255,255,0.7)" : "none",
        borderRight: !left ? "2px solid rgba(255,255,255,0.7)" : "none",
        ...pos,
      }}
    />
  );
}

function crosshair(axis: "h" | "v"): React.CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    background: TEAL,
    transform: "translate(-50%, -50%)",
    ...(axis === "h" ? { width: 16, height: 1.5 } : { width: 1.5, height: 16 }),
  };
}

function hudKey(active: boolean): React.CSSProperties {
  return {
    height: 44,
    minWidth: 44,
    borderRadius: 8,
    border: `1px solid ${active ? AMBER : "var(--hair-2)"}`,
    background: active ? "rgba(244,192,99,0.14)" : "rgba(0,0,0,0.4)",
    color: active ? AMBER : "#fff",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
