/**
 * BoothCountdown , the full-screen capture overlays, all driven purely by
 * `useBoothCapture` state so they carry no logic of their own: the centered
 * big-number self-timer countdown, the flash-only white capture flash, the
 * always-on capture-confirmation border pulse, and the just-captured thumbnail.
 * The keyframes are injected locally (the shared theme ships only
 * spin/pulse/shimmer).
 */

export function BoothCaptureKeyframes() {
  return (
    <style>{`
      @keyframes pbCountPop {
        0% { transform: scale(1.7); opacity: 0; }
        30% { opacity: 1; }
        100% { transform: scale(1); opacity: 0.9; }
      }
      @keyframes pbCapturePulse {
        0% { opacity: 0; }
        18% { opacity: 1; }
        100% { opacity: 0; }
      }
      @keyframes pbShotPop {
        0% { transform: translateY(18px) scale(0.6); opacity: 0; }
        14% { transform: translateY(0) scale(1.06); opacity: 1; }
        26% { transform: scale(1); opacity: 1; }
        82% { opacity: 1; }
        100% { transform: scale(1); opacity: 0; }
      }
    `}</style>
  );
}

/**
 * Always-on capture confirmation: a quick inset white border pulse fired on every
 * frame capture, INDEPENDENT of the flash toggle (the bright FlashOverlay is
 * flash-only). Bright enough to read across the room on the wall panel, brief
 * enough not to blind. Rendered only while `active`, so the one-shot animation
 * replays cleanly on each shot with no transition-state bookkeeping.
 */
export function CapturePulse({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      data-testid="capture-pulse"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 48,
        boxShadow: "inset 0 0 0 5px rgba(255,255,255,0.92), inset 0 0 70px rgba(255,255,255,0.25)",
        animation: "pbCapturePulse 0.32s ease-out",
      }}
    />
  );
}

/**
 * The just-captured frame popping in near the gallery button and settling, then
 * fading , the familiar camera-app "your shot landed here" cue, reusing the baked
 * frame blob (an object URL from useBoothCapture). The PARENT keys this on the
 * shot id so a fresh shot replays the pop while rapid same-shot frames (burst /
 * gif) only swap the image. `filterCss` matches the gallery's display-time filter.
 */
export function ShotThumb({ url, filterCss }: { url: string; filterCss: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 60,
        bottom: 188,
        width: 74,
        height: 74,
        borderRadius: 14,
        overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.9)",
        boxShadow: "0 12px 34px rgba(0,0,0,0.5)",
        zIndex: 47,
        pointerEvents: "none",
        animation: "pbShotPop 2.2s ease-out",
      }}
    >
      <img
        src={url}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          filter: filterCss,
        }}
      />
    </div>
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
