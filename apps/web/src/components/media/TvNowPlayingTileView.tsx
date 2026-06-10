/**
 * TvNowPlayingTileView — pure presentational component for the TV Now Playing
 * tile (4×3 grid cell). Driven entirely by props; zero tRPC/data dependencies.
 *
 * Source-aware states (A19): streaming playing/paused, line-in, TV (live TV),
 * idle. All built from shared ui primitives (A17). Skeleton renders in the
 * exact slot while pending (A18).
 */

import { Skeleton, Tile, TileHeader } from "@/components/ui";

// ── Helper: format seconds → M:SS or H:MM:SS ─────────────────────────────────

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

// ── Skeleton — exact slot matches populated layout ───────────────────────────

function TvNowPlayingSkeleton() {
  return (
    <Tile padding={18} style={{ gap: 12 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
        <Skeleton w={90} h={17} borderRadius={4} />
        <div style={{ marginLeft: "auto" }}>
          <Skeleton w={64} h={22} borderRadius={999} />
        </div>
      </div>
      {/* Artwork placeholder */}
      <Skeleton w="100%" h={120} borderRadius={10} />
      {/* Title */}
      <Skeleton w="80%" h={16} borderRadius={4} />
      {/* Source line */}
      <Skeleton w="50%" h={13} borderRadius={4} />
      {/* Scrub bar */}
      <Skeleton w="100%" h={8} borderRadius={999} />
      {/* Time row */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton w={36} h={12} borderRadius={4} />
        <Skeleton w={36} h={12} borderRadius={4} />
      </div>
      {/* Transport row */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 4 }}>
        <Skeleton w={36} h={36} borderRadius={999} />
        <Skeleton w={44} h={44} borderRadius={999} />
        <Skeleton w={36} h={36} borderRadius={999} />
      </div>
    </Tile>
  );
}

// ── Transport controls ────────────────────────────────────────────────────────

interface TransportProps {
  state: string;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
}

function Transport({ state, onPrev, onPlayPause, onNext }: TransportProps) {
  const isPlaying = state === "playing";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        flexShrink: 0,
      }}
    >
      <button type="button" aria-label="Previous" onClick={onPrev} style={transportBtn(64)}>
        {/* ⏮ prev */}
        <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={onPlayPause}
        style={transportBtn(84)}
      >
        {isPlaying ? (
          /* ⏸ pause */
          <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 19h4V5H6zm8-14v14h4V5z" />
          </svg>
        ) : (
          /* ▶ play */
          <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <button type="button" aria-label="Next" onClick={onNext} style={transportBtn(64)}>
        {/* ⏭ next */}
        <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 18l8.5-6L6 6zm8.5-6V6H17v12h-2.5z" />
        </svg>
      </button>
    </div>
  );
}

function transportBtn(size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    background: "var(--tile-2)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--ink)",
    padding: 0,
    font: "inherit",
  };
}

// ── Scrub bar ─────────────────────────────────────────────────────────────────

interface ScrubBarProps {
  position: number;
  duration: number;
  onSeek: (positionSeconds: number) => void;
}

function ScrubBar({ position, duration, onSeek }: ScrubBarProps) {
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Track + fill */}
      <div
        data-scrub
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        style={{
          position: "relative",
          height: 6,
          borderRadius: 999,
          // --hair-2, not --tile-2: the track must read against the tile surface.
          background: "var(--hair-2)",
          cursor: "pointer",
        }}
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(fraction * duration);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, position + 10));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, position - 10));
        }}
      >
        <div
          data-scrub-fill
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: "var(--ink)",
          }}
        />
        {/* Thumb — keeps the scrubber legible even at ~0% progress */}
        <div
          data-scrub-thumb
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "var(--ink)",
          }}
        />
      </div>
      {/* Position / duration */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
          {formatTime(position)}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

// ── Source pill ───────────────────────────────────────────────────────────────

function sourceLabel(source: TvSource, appName: string | null): string {
  if (source === "idle") return "Standby";
  if (source === "line-in") return "Line In";
  if (source === "TV") return "Live TV";
  return appName ?? "Streaming";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TvSource = "streaming" | "line-in" | "TV" | "idle";

export type TvNowPlayingTileViewProps =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "populated";
      state: string;
      appName: string | null;
      mediaTitle: string | null;
      mediaArtist: string | null;
      mediaPosition: number | null;
      mediaDuration: number | null;
      source: TvSource;
      artworkUrl: string | null;
      onPrev?: () => void;
      onPlayPause?: () => void;
      onNext?: () => void;
      onSeek?: (positionSeconds: number) => void;
      /** Opens the Transport & Scrub detail modal (A20). */
      onOpenTransport?: () => void;
      /** Opens the TV Remote D-pad modal (A21). */
      onOpenRemote?: () => void;
    };

// ── Pure view ─────────────────────────────────────────────────────────────────

export function TvNowPlayingTileView(props: TvNowPlayingTileViewProps) {
  if (props.status !== "populated") {
    return <TvNowPlayingSkeleton />;
  }

  const {
    state,
    appName,
    mediaTitle,
    mediaArtist,
    mediaPosition,
    mediaDuration,
    source,
    artworkUrl,
    onPrev = () => {},
    onPlayPause = () => {},
    onNext = () => {},
    onSeek = () => {},
    onOpenTransport,
    onOpenRemote,
  } = props;

  const isIdle = source === "idle";
  const hasProgress = mediaPosition !== null && mediaDuration !== null && mediaDuration > 0;

  return (
    <Tile padding={18} style={{ gap: 10 }}>
      {/* Header with optional modal-open buttons */}
      <TileHeader
        icon="cam"
        title="TV"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {onOpenRemote && (
              <button
                type="button"
                data-open-remote
                aria-label="Remote"
                onClick={onOpenRemote}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ink-3)",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {/* D-pad icon */}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M10 2v4H7l5 5 5-5h-3V2zM2 10h4v3l5-5-5-5v3H2zm8 12v-4h3l-5-5-5 5h3v4zm12-8h-4v-3l-5 5 5 5v-3h4z" />
                </svg>
              </button>
            )}
            {onOpenTransport && (
              <button
                type="button"
                data-open-transport
                aria-label="Detail"
                onClick={onOpenTransport}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--ink-3)",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {/* expand icon */}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" />
                </svg>
              </button>
            )}
            <span className="pill" style={{ fontSize: 11, padding: "3px 9px" }}>
              {sourceLabel(source, appName)}
            </span>
          </div>
        }
      />

      {/* Artwork or placeholder — the ONLY flexible row, so it absorbs all
          height slack and the text/scrub/transport rows below are never
          squeezed (the artist line used to clip under the scrub bar). */}
      {artworkUrl ? (
        <img
          data-artwork
          src={artworkUrl}
          alt="Now playing artwork"
          style={{
            width: "100%",
            flexGrow: 1,
            flexBasis: 0,
            minHeight: 0,
            objectFit: "cover",
            borderRadius: 10,
          }}
        />
      ) : (
        <div
          data-artwork
          style={{
            width: "100%",
            flexGrow: 1,
            flexBasis: 0,
            minHeight: 0,
            borderRadius: 10,
            background: "var(--tile-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isIdle && <span style={{ color: "var(--ink-3)", fontSize: 13 }}>Standby</span>}
        </div>
      )}

      {/* Title + artist (streaming) */}
      {!isIdle && (
        <div data-media-text style={{ flexShrink: 0 }}>
          {mediaTitle && (
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mediaTitle}
            </div>
          )}
          {(mediaArtist ?? appName) && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-2)",
                marginTop: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mediaArtist ?? appName}
            </div>
          )}
        </div>
      )}

      {/* Scrub bar (only when position + duration available) */}
      {hasProgress && (
        <ScrubBar
          position={mediaPosition as number}
          duration={mediaDuration as number}
          onSeek={onSeek}
        />
      )}

      {/* Transport controls (not in idle) */}
      {!isIdle && (
        <Transport state={state} onPrev={onPrev} onPlayPause={onPlayPause} onNext={onNext} />
      )}
    </Tile>
  );
}
