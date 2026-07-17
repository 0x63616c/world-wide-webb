/**
 * CleanScreenOverlayView , the Tesla-style screen-cleaning lock, dumb layer.
 *
 * Three elements on black: "Cleaning mode", the remaining time, and the
 * press-and-hold exit button whose WHITE fill sweeps left to right with
 * `holdProgress`. The overlay root swallows every pointer event; only the
 * button's hold handlers do anything. Timers and the hold gesture live in
 * CleanScreenOverlay.
 */

export interface CleanScreenOverlayViewProps {
  remainingMs: number;
  /** 0..1, how far the current press is through the 3s hold. */
  holdProgress: number;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function CleanScreenOverlayView({
  remainingMs,
  holdProgress,
  onHoldStart,
  onHoldEnd,
}: CleanScreenOverlayViewProps) {
  return (
    <div
      data-testid="clean-screen-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 36,
        fontFamily: "var(--ui)",
        color: "var(--ink)",
        userSelect: "none",
        // The whole point: wipes land here and go nowhere.
        touchAction: "none",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 500, color: "var(--ink-2)" }}>Cleaning mode</div>

      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 64,
          lineHeight: 1,
          color: "var(--ink-3)",
        }}
      >
        {formatCountdown(remainingMs)}
      </div>

      <button
        type="button"
        onPointerDown={onHoldStart}
        onPointerUp={onHoldEnd}
        onPointerLeave={onHoldEnd}
        onPointerCancel={onHoldEnd}
        style={{
          position: "relative",
          width: 320,
          height: 64,
          borderRadius: 16,
          border: "1px solid var(--hair-2)",
          background: "none",
          overflow: "hidden",
          fontSize: 15,
          fontFamily: "var(--ui)",
          color: "var(--ink-2)",
          touchAction: "none",
          cursor: "pointer",
        }}
      >
        <div
          data-testid="clean-hold-fill"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${holdProgress * 100}%`,
            background: "rgba(255, 255, 255, 0.28)",
            // The container ticks progress at 250ms; a matching linear
            // transition turns the steps into a continuous sweep. Releasing
            // resets to 0 through the same transition, which reads as the
            // fill draining , fine.
            transition: holdProgress > 0 ? "width 250ms linear" : "width 150ms ease-out",
          }}
        />
        <span style={{ position: "relative" }}>Press and hold to exit</span>
      </button>
    </div>
  );
}
