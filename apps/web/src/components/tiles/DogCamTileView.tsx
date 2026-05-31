import { Icon } from "../Icon";
import { Skeleton, Tile, TileHeader } from "../ui";

/** Format elapsed seconds as HH:MM:SS */
function formatRec(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export type DogCamTileStatus = "loading" | "error" | "populated";

export interface DogCamTileViewProps {
  status: DogCamTileStatus;
  label?: string | null;
  online?: boolean;
  snapshotUrl?: string | null;
  /** Whether the live feed overlay is currently visible — local presentation state owned by the container */
  live: boolean;
  /** Elapsed recording seconds — driven by the container's interval */
  recSecs: number;
  onToggleLive: () => void;
}

export function DogCamTileView({
  status,
  label,
  online,
  snapshotUrl,
  live,
  recSecs,
  onToggleLive,
}: DogCamTileViewProps) {
  // Error is treated the same as loading — shimmer cover, keep retrying via QueryClient
  const isLoading = status === "loading" || status === "error";

  return (
    <Tile padding={22}>
      <TileHeader icon="cam" title="Dog Cam" />
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
        onClick={onToggleLive}
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
            alt={label ?? ""}
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
          // Dark gradient background when no snapshot is available
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
              {label ?? <Skeleton w={80} h={12} />}
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
            {isLoading || !label ? (
              <Icon name="cam" s={30} c="var(--ink-3)" />
            ) : (
              <>
                <Icon name="cam" s={30} c="var(--ink-2)" />
                <div style={{ fontSize: 16, fontWeight: 500 }}>
                  {label ?? <Skeleton w={100} h={16} />}
                </div>
                <div className="cap">
                  {online === false ? "Camera offline" : "Tap to view feed"}
                </div>
              </>
            )}
          </div>
        )}
      </button>
    </Tile>
  );
}
