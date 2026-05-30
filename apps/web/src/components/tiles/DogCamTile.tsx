import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { Icon } from "../Icon";

/** Format elapsed seconds as HH:MM:SS */
function formatRec(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function DogCamTile() {
  const [live, setLive] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isLoading } = trpc.camera.info.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: 2,
  });

  // Manage REC timer
  useEffect(() => {
    if (live) {
      setRecSecs(0);
      timerRef.current = setInterval(() => {
        setRecSecs((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecSecs(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [live]);

  const label = data?.label ?? "Living Room";
  const snapshotUrl = data?.snapshotUrl ?? null;
  const online = data?.online ?? false;

  return (
    <div
      className="tile"
      style={{ height: "100%", padding: 16, display: "flex", flexDirection: "column" }}
    >
      {/* Feed shell — fills remaining space */}
      <button
        type="button"
        className="feed"
        style={{
          flex: 1,
          minHeight: 0,
          cursor: "pointer",
          padding: 0,
          textAlign: "inherit",
          font: "inherit",
          color: "inherit",
        }}
        onClick={() => setLive((v) => !v)}
        aria-label={live ? "Hide camera feed" : "View camera feed"}
      >
        {/* Dog ghost icon — z-index 0, always behind content */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 0,
            color: "var(--ink-3)",
            opacity: 0.55,
          }}
        >
          <Icon name="dog" s={58} c="currentColor" sw={1.3} />
        </div>

        {/* Snapshot / placeholder area — z-index 1 */}
        {snapshotUrl ? (
          <img
            src={snapshotUrl}
            alt={label}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 1,
            }}
          />
        ) : (
          // Designed placeholder — dark gradient background, already set by .feed background
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#0A0C0E",
              zIndex: 1,
            }}
          />
        )}

        {/* Scanline overlay — z-index 3 */}
        <div className="scan" />

        {/* Live state: LIVE dot, REC timer, caption */}
        {live ? (
          <>
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: 4,
              }}
            >
              <span className="dot" />
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--acc)",
                  letterSpacing: ".12em",
                  textShadow: "0 1px 4px #000",
                }}
              >
                LIVE
              </span>
            </div>
            <div
              style={{ position: "absolute", top: 12, right: 13, zIndex: 4 }}
              className="mono cap"
            >
              REC {formatRec(recSecs)}
            </div>
            <div
              style={{
                position: "absolute",
                bottom: 12,
                left: 13,
                zIndex: 4,
                textShadow: "0 1px 4px #000",
              }}
              className="cap"
            >
              {label}
            </div>
          </>
        ) : (
          /* Covered state: frosted-glass overlay */
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              background: "rgba(18,22,26,.42)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
            }}
          >
            {isLoading ? (
              <Icon name="cam" s={30} c="var(--ink-3)" />
            ) : (
              <>
                <Icon name="cam" s={30} c="var(--ink-2)" />
                <div style={{ fontSize: 16, fontWeight: 500 }}>{label}</div>
                <div className="cap">
                  {online === false && !isLoading ? "Camera offline" : "Tap to view feed"}
                </div>
              </>
            )}
          </div>
        )}
      </button>
    </div>
  );
}
