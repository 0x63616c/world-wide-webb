/**
 * Design 02 , "Arcade Booth": a retro coin-op photo booth. A chasing light-bulb
 * marquee crowns the frame, the preview sits behind a CRT bezel with scanlines,
 * and the controls are chunky plastic arcade buttons , a fat red PUSH shutter,
 * coin-slot countdown, and a lever-style flash toggle.
 */

import { Images, X } from "lucide-react";
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

const CREAM = "#f7ecd2";
const RED = "#e63b3b";

export function CameraDesign02() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("sepia");
  const [mode, setMode] = useState("grid");
  const [countdown, setCountdown] = useState<CountdownOption>(3);
  const [flashOn, setFlashOn] = useState(true);
  const capture = useCapture({ countdown, flashOn });

  return (
    <div
      style={{
        ...panelRoot("repeating-linear-gradient(45deg, #3a1616 0 40px, #341313 40px 80px)"),
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <CameraKeyframes />

      {/* Marquee */}
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          background: "linear-gradient(180deg, #b0241f, #7d1512)",
          border: "3px solid #4a0d0b",
          padding: "16px 26px",
          textAlign: "center",
          boxShadow: "inset 0 2px 0 rgba(255,255,255,0.25)",
        }}
      >
        <BulbRow count={22} />
        <div
          style={{
            fontFamily: "var(--mono)",
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: "0.22em",
            color: CREAM,
            textShadow: "0 2px 0 #4a0d0b, 0 0 22px rgba(247,236,210,0.4)",
          }}
        >
          PHOTO BOOTH
        </div>
        <button
          type="button"
          aria-label="Close"
          style={{
            position: "absolute",
            top: 12,
            right: 14,
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "2px solid #4a0d0b",
            background: "#f7ecd2",
            color: "#7d1512",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", gap: 20, minHeight: 0 }}>
        {/* Preview inside CRT bezel */}
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 26,
              padding: 16,
              background: "linear-gradient(160deg, #2a2a2e, #141416)",
              border: "3px solid #050506",
              boxShadow: "inset 0 3px 10px rgba(0,0,0,0.6)",
            }}
          >
            <CameraStage
              preview={preview}
              filterId={filter}
              radius={14}
              style={{ position: "absolute", inset: 16 }}
            >
              {/* Scanlines + vignette */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background:
                    "repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0 2px, transparent 2px 4px)",
                  mixBlendMode: "multiply",
                }}
              />
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  boxShadow: "inset 0 0 120px rgba(0,0,0,0.55)",
                  borderRadius: 14,
                }}
              />
              <CountdownOverlay count={capture.count} color={CREAM} />
              <FlashOverlay active={capture.flashing} />
            </CameraStage>
          </div>
        </div>

        {/* Right control rack */}
        <div
          style={{
            width: 260,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            background: "linear-gradient(180deg, #d8c7a2, #c3b088)",
            border: "3px solid #4a0d0b",
            borderRadius: 20,
            padding: 18,
          }}
        >
          <RackLabel>Filter</RackLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {CAMERA_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                style={arcadeChip(f.id === filter)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <RackLabel>Mode</RackLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {CAMERA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={m.disabled}
                onClick={() => !m.disabled && setMode(m.id)}
                style={arcadeChip(m.id === mode, m.disabled)}
              >
                {m.label}
                {m.disabled ? " ○" : ""}
              </button>
            ))}
          </div>

          <RackLabel>Coins / Timer</RackLabel>
          <div style={{ display: "flex", gap: 6 }}>
            {COUNTDOWN_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCountdown(c)}
                style={{
                  ...coinBtn(c === countdown),
                  flex: 1,
                }}
              >
                {countdownLabel(c)}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: "auto", alignItems: "center" }}>
            <LeverToggle on={flashOn} onToggle={() => setFlashOn((v) => !v)} />
            <button
              type="button"
              aria-label="Prints"
              style={{
                marginLeft: "auto",
                width: 56,
                height: 56,
                borderRadius: 12,
                border: "3px solid #4a0d0b",
                background: CREAM,
                color: "#7d1512",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Images size={24} />
            </button>
          </div>
        </div>
      </div>

      {/* Big PUSH shutter */}
      <button
        type="button"
        onClick={capture.shoot}
        style={{
          alignSelf: "center",
          width: 340,
          height: 78,
          borderRadius: 40,
          border: "4px solid #5a0b0b",
          background: capture.capturing
            ? `radial-gradient(circle at 50% 30%, #ff7a7a, ${RED})`
            : `radial-gradient(circle at 50% 30%, #ff6b6b, ${RED})`,
          color: "#fff",
          fontFamily: "var(--mono)",
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: "0.3em",
          cursor: "pointer",
          boxShadow: capture.capturing
            ? "inset 0 4px 12px rgba(0,0,0,0.5)"
            : "0 8px 0 #7d1512, inset 0 2px 0 rgba(255,255,255,0.4)",
          transform: capture.capturing ? "translateY(6px)" : "none",
          transition: "transform 0.08s ease, box-shadow 0.08s ease",
        }}
      >
        PUSH
      </button>
    </div>
  );
}

function BulbRow({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: "6px 10px auto",
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bulb strip, never reordered.
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "#ffe9a8",
            color: "#ffe9a8",
            animation: "pbBulbChase 0.9s steps(1) infinite",
            animationDelay: `${(i % 2) * 0.45}s`,
          }}
        />
      ))}
    </div>
  );
}

function RackLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "#7d1512",
      }}
    >
      {children}
    </div>
  );
}

function arcadeChip(active: boolean, disabled?: boolean): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "2px solid #4a0d0b",
    background: disabled ? "#a99b7c" : active ? RED : CREAM,
    color: disabled ? "#6b5f45" : active ? "#fff" : "#4a0d0b",
    fontFamily: "var(--mono)",
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    boxShadow: active ? "inset 0 2px 6px rgba(0,0,0,0.35)" : "0 2px 0 #4a0d0b",
  };
}

function coinBtn(active: boolean): React.CSSProperties {
  return {
    height: 40,
    borderRadius: "50%",
    border: "2px solid #4a0d0b",
    background: active ? "#f4c063" : "#e7d8b4",
    color: "#4a0d0b",
    fontFamily: "var(--mono)",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
    boxShadow: active ? "inset 0 2px 5px rgba(0,0,0,0.35)" : "0 2px 0 #4a0d0b",
  };
}

function LeverToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Flash"
      aria-pressed={on}
      style={{
        width: 64,
        height: 40,
        borderRadius: 20,
        border: "3px solid #4a0d0b",
        background: on ? "#f4c063" : "#8a7c5c",
        position: "relative",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 28 : 1,
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: CREAM,
          border: "2px solid #4a0d0b",
          transition: "left 0.14s ease",
          fontSize: 8,
          fontWeight: 700,
          color: "#4a0d0b",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--mono)",
        }}
      >
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}
