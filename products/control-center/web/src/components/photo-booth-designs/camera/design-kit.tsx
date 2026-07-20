/**
 * design-kit , the handful of visual atoms shared across the camera concepts:
 * the full-screen root box, the capture flash overlay, a default big-number
 * countdown, and a translucent circular icon button. Concepts that want a
 * distinct treatment (the party countdown, the brutalist buttons) roll their
 * own; these keep the common cases from being copy-pasted ten times.
 */

import type { CSSProperties } from "react";

/**
 * Custom keyframes used across the camera concepts. The shared theme only ships
 * `spin`/`pulse`/`shimmer`, and these prototypes must not edit theme.css, so
 * every design renders this once (duplicate <style> tags are harmless) to make
 * its animations available inside the Storybook iframe.
 */
export function CameraKeyframes() {
  return (
    <style>{`
      @keyframes pbCountPop {
        0% { transform: scale(1.7); opacity: 0; }
        30% { opacity: 1; }
        100% { transform: scale(1); opacity: 0.9; }
      }
      @keyframes pbConfettiFall {
        0% { transform: translateY(-40px) rotate(0deg); opacity: 0; }
        10% { opacity: 1; }
        100% { transform: translateY(1100px) rotate(720deg); opacity: 1; }
      }
      @keyframes pbBulbChase {
        0%, 49% { opacity: 1; box-shadow: 0 0 12px 2px currentColor; }
        50%, 100% { opacity: 0.28; box-shadow: none; }
      }
      @keyframes pbScan {
        0% { transform: translateY(-100%); }
        100% { transform: translateY(100%); }
      }
      @keyframes pbFloat {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      @keyframes pbRecBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.25; }
      }
      @keyframes pbSweep {
        0% { background-position: -150% 0; }
        100% { background-position: 250% 0; }
      }
      @keyframes pbRingPulse {
        0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.5); }
        100% { box-shadow: 0 0 0 26px rgba(255,255,255,0); }
      }
    `}</style>
  );
}

/** Fixed full-bleed root filling the story's 1366×1024 stage. */
export function panelRoot(background: string): CSSProperties {
  return {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    background,
    fontFamily: "var(--ui)",
    color: "#fff",
    letterSpacing: "-0.01em",
    userSelect: "none",
  };
}

/** Circular translucent control button, active state brightens it. */
export function iconBtn(active: boolean): CSSProperties {
  return {
    height: 48,
    width: 48,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    cursor: "pointer",
    background: active ? "#f4c063" : "rgba(0,0,0,0.42)",
    color: active ? "#1a1206" : "#fff",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    font: "inherit",
    transition: "background 0.15s ease, color 0.15s ease",
  };
}

/** White flash overlay driven by useCapture().flashing. */
export function FlashOverlay({ active, color = "#fff" }: { active: boolean; color?: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: color,
        opacity: active ? 1 : 0,
        transition: active ? "none" : "opacity 0.35s ease",
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}

/** Centered big-number countdown; renders nothing when idle. */
export function CountdownOverlay({
  count,
  color = "#fff",
}: {
  count: number | null;
  color?: string;
}) {
  if (count === null) return null;
  return (
    <div
      aria-live="assertive"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 40,
      }}
    >
      <span
        key={count}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 280,
          fontWeight: 700,
          color,
          textShadow: "0 8px 60px rgba(0,0,0,0.6)",
          animation: "pbCountPop 1s ease-out",
        }}
      >
        {count}
      </span>
    </div>
  );
}
