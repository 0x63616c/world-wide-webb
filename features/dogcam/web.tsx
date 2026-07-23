import { Icon } from "@/components/Icon";
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { openTileDetail } from "@/lib/tile-detail-store";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";

/** Format elapsed seconds as HH:MM:SS */
function formatRec(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export type DogCamTileStatus = TileStatus;

export interface DogCamTileViewProps {
  status: DogCamTileStatus;
  label?: string | null;
  online?: boolean;
  snapshotUrl?: string | null;
  /**
   * MJPEG stream URL (the api's /media/camera-stream proxy in front of go2rtc).
   * A multipart/x-mixed-replace response renders natively in an <img>, which is
   * why MJPEG was chosen, an <img> cannot send auth headers, so the old HA
   * camera_proxy approach was unusable.
   */
  streamUrl?: string | null;
  /** Whether the live feed overlay is currently visible, local presentation state owned by the container */
  live: boolean;
  /** Elapsed recording seconds, driven by the container's interval */
  recSecs: number;
  onToggleLive: () => void;
}

export function DogCamTileView({
  status,
  label,
  online,
  snapshotUrl,
  streamUrl,
  live,
  recSecs,
  onToggleLive,
}: DogCamTileViewProps) {
  // Error is treated the same as loading, shimmer cover, keep retrying via QueryClient
  const isLoading = status === TileStatus.Loading || status === TileStatus.Error;

  return (
    <Tile padding={22}>
      {/* Title MUST stay in sync with the manifest label in features/dogcam/manifest.ts, the minimap and pan labels read it. */}
      <TileHeader icon="cam" title="Living Room Cam" />
      {/* Feed shell, fills remaining space */}
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
        {/* Dog ghost icon, z-index 0, always behind content */}
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

        {/* Snapshot / placeholder area, z-index 1 */}
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
              background: "var(--tile)",
              zIndex: 1,
            }}
          />
        )}

        {/*
          Live MJPEG stream, z-index 2, above the snapshot poster.
          Mounted ONLY while live: the browser holds the multipart connection open
          for as long as this <img> exists, so keeping it mounted under the frosted
          cover would pin an open stream to go2rtc forever. Unmounting on !live
          tears the connection down.
        */}
        {live && streamUrl ? (
          <img
            src={streamUrl}
            alt={label ?? "Live camera feed"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 2,
            }}
          />
        ) : null}

        {/* Scanline overlay, z-index 3 */}
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

/**
 * Thin container for the Living Room Cam tile face. The face stays covered
 * (frosted snapshot poster), tapping the feed opens the full-page detail via
 * the tile-detail registry (apps/web/src/components/tiles/detail/wiring/dogcam.tsx),
 * which owns the live/REC toggle the face used to run inline.
 */
export function DogCamTile() {
  const { status, data } = useTileQuery(
    trpc.camera.info.useQuery(undefined, {
      refetchInterval: POLL.dogcam,
      retry: 2,
    }),
  );

  return (
    <DogCamTileView
      status={status}
      label={data?.label ?? null}
      online={data?.online ?? false}
      snapshotUrl={data?.snapshotUrl ?? null}
      streamUrl={data?.streamUrl ?? null}
      live={false}
      recSecs={0}
      onToggleLive={() => openTileDetail("tile_dogcam")}
    />
  );
}
