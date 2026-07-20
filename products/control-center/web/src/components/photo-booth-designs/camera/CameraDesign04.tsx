/**
 * Design 04 , "Brutal": brutalist monochrome. Hard black hairlines on paper
 * white, no radii, everything in Space Mono, oversized structural labels.
 * Controls are boxed cells that invert (solid black) when active; the shutter
 * is a full-width slab. Deliberately austere , the opposite of the party mode.
 */

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
import { CameraKeyframes, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

const B = "#0a0a0a";
const W = "#f4f4f0";

export function CameraDesign04() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("noir");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div
      style={{
        ...panelRoot(W),
        color: B,
        padding: 24,
        display: "grid",
        gridTemplateColumns: "1fr 320px",
        gridTemplateRows: "auto 1fr auto",
        gap: 0,
        border: `4px solid ${B}`,
        fontFamily: "var(--mono)",
      }}
    >
      <CameraKeyframes />

      {/* Header spanning full width */}
      <div
        style={{
          gridColumn: "1 / -1",
          borderBottom: `4px solid ${B}`,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{ padding: "14px 20px", fontSize: 40, fontWeight: 700, letterSpacing: "-0.02em" }}
        >
          CAMERA_
        </div>
        <button
          type="button"
          aria-label="Close"
          style={hardBtn(false, {
            borderRight: "none",
            borderTop: "none",
            borderBottom: "none",
            width: 88,
            fontSize: 28,
          })}
        >
          ✕
        </button>
      </div>

      {/* Preview */}
      <div style={{ borderRight: `4px solid ${B}`, position: "relative" }}>
        <CameraStage
          preview={preview}
          filterId={filter}
          radius={0}
          style={{ position: "absolute", inset: 0 }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: `inset 0 0 0 12px ${W}, inset 0 0 0 16px ${B}`,
            }}
          />
          {capture.count !== null && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "rgba(244,244,240,0.7)",
              }}
            >
              <span style={{ fontSize: 240, fontWeight: 700, color: B }}>{capture.count}</span>
            </div>
          )}
          {capture.flashing && <div style={{ position: "absolute", inset: 0, background: W }} />}
          {/* corner registration marks */}
          <Corner pos={{ top: 20, left: 20 }} />
          <Corner pos={{ top: 20, right: 20 }} />
          <Corner pos={{ bottom: 20, left: 20 }} />
          <Corner pos={{ bottom: 20, right: 20 }} />
        </CameraStage>
      </div>

      {/* Right column controls */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <SectionHead>FILTER</SectionHead>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {CAMERA_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              style={hardBtn(f.id === filter, {
                borderTop: "none",
                borderLeft: "none",
                padding: "12px 8px",
                fontSize: 12,
              })}
            >
              {f.label.toUpperCase()}
            </button>
          ))}
        </div>

        <SectionHead>MODE</SectionHead>
        {CAMERA_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={m.disabled}
            onClick={() => !m.disabled && setMode(m.id)}
            style={hardBtn(m.id === mode, {
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              padding: "11px 14px",
              fontSize: 13,
              textAlign: "left",
              justifyContent: "space-between",
              opacity: m.disabled ? 0.4 : 1,
              cursor: m.disabled ? "not-allowed" : "pointer",
            })}
          >
            <span>{m.label.toUpperCase()}</span>
            <span style={{ fontSize: 10 }}>
              {m.disabled ? "[SOON]" : m.id === mode ? "[X]" : "[ ]"}
            </span>
          </button>
        ))}

        <SectionHead>TIMER / FLASH</SectionHead>
        <div style={{ display: "flex", borderBottom: `4px solid ${B}` }}>
          {COUNTDOWN_OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCountdown(c)}
              style={hardBtn(c === countdown, {
                flex: 1,
                borderTop: "none",
                borderBottom: "none",
                borderRight: c === 10 ? "none" : undefined,
                padding: "12px 0",
                fontSize: 12,
              })}
            >
              {countdownLabel(c).toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ display: "flex" }}>
          <button
            type="button"
            onClick={() => setFlashOn((v) => !v)}
            style={hardBtn(flashOn, {
              flex: 1,
              border: "none",
              borderRight: `4px solid ${B}`,
              padding: "14px 0",
              fontSize: 13,
            })}
          >
            FLASH {flashOn ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            aria-label="Roll"
            style={hardBtn(false, { flex: 1, border: "none", padding: "14px 0", fontSize: 13 })}
          >
            ▦ ROLL
          </button>
        </div>
      </div>

      {/* Shutter slab */}
      <button
        type="button"
        onClick={capture.shoot}
        style={{
          gridColumn: "1 / -1",
          borderTop: `4px solid ${B}`,
          background: capture.capturing ? W : B,
          color: capture.capturing ? B : W,
          border: "none",
          borderTopWidth: 4,
          borderTopStyle: "solid",
          borderTopColor: B,
          padding: "22px 0",
          fontFamily: "var(--mono)",
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "0.3em",
          cursor: "pointer",
        }}
      >
        ► CAPTURE
      </button>
    </div>
  );
}

function SectionHead({ children }: { children: string }) {
  return (
    <div
      style={{
        borderBottom: `4px solid ${B}`,
        background: B,
        color: W,
        padding: "6px 14px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.24em",
      }}
    >
      {children}
    </div>
  );
}

function Corner({ pos }: { pos: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        border: `3px solid ${W}`,
        mixBlendMode: "difference",
        ...pos,
      }}
    />
  );
}

function hardBtn(active: boolean, extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: active ? B : "transparent",
    color: active ? W : B,
    border: `4px solid ${B}`,
    fontFamily: "var(--mono)",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    ...extra,
  };
}
