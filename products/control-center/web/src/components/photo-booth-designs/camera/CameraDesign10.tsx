/**
 * Design 10 , "Zen": edge-to-edge calm. The preview is the whole screen and the
 * chrome hides itself. A single hairline shutter ring is always present; tapping
 * anywhere reveals a slim, airy control layer that quietly fades back out. Lots
 * of negative space, whisper-weight type, one restrained accent.
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
  useReveal,
} from "./camera-shared";
import { CameraKeyframes, CountdownOverlay, FlashOverlay, panelRoot } from "./design-kit";
import { useCameraPreview } from "./useCameraPreview";

export function CameraDesign10() {
  const preview = useCameraPreview();
  const [filter, setFilter] = useState("none");
  const [mode, setMode] = useState("photo");
  const [countdown, setCountdown] = useState<CountdownOption>(0);
  const [flashOn, setFlashOn] = useState(false);
  const capture = useCapture({ countdown, flashOn });
  const reveal = useReveal(4200, true);

  const layer: React.CSSProperties = {
    opacity: reveal.visible ? 1 : 0,
    pointerEvents: reveal.visible ? "auto" : "none",
    transition: "opacity 0.6s ease",
  };

  return (
    <div style={panelRoot("#000")}>
      <CameraKeyframes />
      <CameraStage preview={preview} filterId={filter} style={{ position: "absolute", inset: 0 }}>
        {/* Tap-anywhere-to-reveal , a full-bleed transparent button under the
            chrome so the whole preview is a reveal target without an a11y-
            unfriendly onClick on a plain div. Controls stack above it. */}
        <button
          type="button"
          aria-label="Reveal controls"
          onClick={reveal.poke}
          style={{
            position: "absolute",
            inset: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        />
        {/* Top , minimal */}
        <div
          style={{
            ...layer,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "34px 40px",
          }}
        >
          <button type="button" aria-label="Close" style={zenGlyph}>
            <X size={26} />
          </button>
          <div style={{ display: "flex", gap: 26 }}>
            <button
              type="button"
              onClick={() => setFlashOn((v) => !v)}
              aria-label="Flash"
              style={zenGlyph}
            >
              {flashOn ? <Zap size={24} color="#f4c063" /> : <ZapOff size={24} />}
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = COUNTDOWN_OPTIONS.indexOf(countdown);
                setCountdown(COUNTDOWN_OPTIONS[(idx + 1) % COUNTDOWN_OPTIONS.length]);
              }}
              aria-label="Timer"
              style={{ ...zenGlyph, gap: 8, width: "auto" }}
            >
              <Timer size={22} />
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 15,
                  color: countdown ? "#f4c063" : "inherit",
                }}
              >
                {countdownLabel(countdown)}
              </span>
            </button>
            <button type="button" aria-label="Gallery" style={zenGlyph}>
              <Image size={24} />
            </button>
          </div>
        </div>

        <CountdownOverlay count={capture.count} />

        {/* Reveal hint when hidden */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 40,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 12,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
            opacity: reveal.visible ? 0 : 1,
            transition: "opacity 0.6s ease",
          }}
        >
          tap to adjust
        </div>

        {/* Filters , thin dot row */}
        <div
          style={{
            ...layer,
            position: "absolute",
            left: "50%",
            bottom: 168,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 22,
            alignItems: "center",
          }}
        >
          {CAMERA_FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-label={f.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 9,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: active ? "#fff" : "rgba(255,255,255,0.5)",
                  font: "inherit",
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: active ? "#fff" : "rgba(255,255,255,0.4)",
                    transform: active ? "scale(1.4)" : "scale(1)",
                    transition: "transform 0.2s ease, background 0.2s ease",
                  }}
                />
                <span style={{ fontSize: 11, letterSpacing: "0.08em", opacity: active ? 1 : 0.7 }}>
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mode , whisper text row */}
        <div
          style={{
            ...layer,
            position: "absolute",
            left: "50%",
            bottom: 46,
            transform: "translateX(-50%)",
            display: "flex",
            gap: 30,
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
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
                  background: "none",
                  border: "none",
                  cursor: m.disabled ? "default" : "pointer",
                  font: "inherit",
                  fontWeight: active ? 700 : 400,
                  color: m.disabled
                    ? "rgba(255,255,255,0.28)"
                    : active
                      ? "#fff"
                      : "rgba(255,255,255,0.55)",
                  borderBottom: active ? "1px solid #fff" : "1px solid transparent",
                  paddingBottom: 4,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Always-present shutter , hairline ring */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            reveal.poke();
            capture.shoot();
          }}
          aria-label="Shutter"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 92,
            transform: `translateX(-50%) scale(${capture.capturing ? 0.9 : 1})`,
            width: 78,
            height: 78,
            borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,0.9)",
            background: "transparent",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            transition: "transform 0.12s ease",
            animation: capture.armed ? "pbRingPulse 1s ease-out infinite" : undefined,
          }}
        >
          <span
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: "#fff",
              transform: capture.capturing ? "scale(0.82)" : "scale(1)",
              transition: "transform 0.12s ease",
            }}
          />
        </button>

        <FlashOverlay active={capture.flashing} />
      </CameraStage>
    </div>
  );
}

const zenGlyph: React.CSSProperties = {
  height: 46,
  minWidth: 46,
  borderRadius: "50%",
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textShadow: "0 1px 6px rgba(0,0,0,0.6)",
};
