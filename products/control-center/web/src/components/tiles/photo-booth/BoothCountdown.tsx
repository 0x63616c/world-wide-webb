/**
 * BoothCountdown , the two full-screen capture overlays: the centered big-number
 * self-timer countdown and the white capture flash. Both are driven purely by
 * `useBoothCapture` state so they carry no logic of their own. The countdown pop
 * keyframe is injected locally (the shared theme ships only spin/pulse/shimmer).
 */

export function BoothCaptureKeyframes() {
  return (
    <style>{`
      @keyframes pbCountPop {
        0% { transform: scale(1.7); opacity: 0; }
        30% { opacity: 1; }
        100% { transform: scale(1); opacity: 0.9; }
      }
    `}</style>
  );
}

/** White flash overlay driven by useBoothCapture().flashing. */
export function FlashOverlay({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background: "#fff",
        opacity: active ? 1 : 0,
        transition: active ? "none" : "opacity 0.35s ease",
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}

/** Centered big-number countdown; renders nothing when idle. */
export function CountdownOverlay({ count }: { count: number | null }) {
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
          color: "#fff",
          textShadow: "0 8px 60px rgba(0,0,0,0.6)",
          animation: "pbCountPop 1s ease-out",
        }}
      >
        {count}
      </span>
    </div>
  );
}
