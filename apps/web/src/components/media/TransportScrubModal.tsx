/**
 * TransportScrubModal — detail modal for TV Now Playing transport & seek
 * (www-51hf.16).
 *
 * Shows large artwork, title/artist, a draggable scrubber (seek fires on
 * pointer release so a drag doesn't spam seeks), a transport row with
 * shuffle/prev/play-pause/next, and a volume slider. For line-in or TV
 * sources a no-seek note replaces the scrubber (live feeds have no position).
 *
 * All visible state is driven by props; zero tRPC dependencies — the container
 * (TvNowPlayingTile) wires the mutations.
 *
 * Built exclusively from shared ui primitives (A17): Modal, Skeleton.
 */

import { useRef, useState } from "react";
import { Modal } from "@/components/ui";
import type { TvSource } from "./TvNowPlayingTileView";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransportScrubModalProps {
  open: boolean;
  onClose: () => void;
  state: string;
  appName: string | null;
  mediaTitle: string | null;
  mediaArtist: string | null;
  mediaPosition: number | null;
  mediaDuration: number | null;
  source: TvSource;
  artworkUrl: string | null;
  /** Volume 0-100 integer for the volume slider. */
  volume: number;
  onPrev?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
  onShuffle?: () => void;
  /** Called with the target position in seconds on pointer-release. */
  onSeek?: (positionSeconds: number) => void;
  /** Called with the target volume 0-100 when the volume slider changes. */
  onVolumeChange?: (volume: number) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    color: "var(--ink-1)",
    padding: 0,
    font: "inherit",
    flexShrink: 0,
  };
}

// ── Draggable scrub bar ───────────────────────────────────────────────────────
// Fires onSeek only on pointer-release so a drag gesture doesn't spam seeks.
// Local draft position gives instant visual feedback while dragging.

interface ScrubBarProps {
  position: number;
  duration: number;
  onSeek: (positionSeconds: number) => void;
}

function ScrubBar({ position, duration, onSeek }: ScrubBarProps) {
  // Local draft: null = use position prop; set when dragging.
  const [draftPct, setDraftPct] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const displayPct =
    draftPct !== null ? draftPct : duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  function pctFromPointer(clientX: number): number {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
    setDraftPct(pctFromPointer(e.clientX));
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    setDraftPct(pctFromPointer(e.clientX));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    const pct = pctFromPointer(e.clientX);
    setDraftPct(null);
    onSeek((pct / 100) * duration);
  }

  return (
    <div>
      <div
        ref={trackRef}
        data-scrub
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(displayPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        style={{
          position: "relative",
          height: 8,
          borderRadius: 999,
          background: "var(--tile-2)",
          cursor: "pointer",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(duration, position + 10));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, position - 10));
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${displayPct}%`,
            borderRadius: 999,
            background: "var(--ink-1)",
            pointerEvents: "none",
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${displayPct}%`,
            transform: "translate(-50%, -50%)",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--ink-1)",
            pointerEvents: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
          {formatTime(position)}
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

// ── No-seek note (line-in / TV) ───────────────────────────────────────────────

function NoSeekNote({ source }: { source: TvSource }) {
  const label = source === "line-in" ? "Line In — seek unavailable" : "Live TV — seek unavailable";
  return (
    <div
      data-no-seek
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--tile-2)",
        color: "var(--ink-3)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {label}
    </div>
  );
}

// ── Volume slider ─────────────────────────────────────────────────────────────

interface VolumeSliderProps {
  volume: number;
  onChange: (v: number) => void;
}

function VolumeSlider({ volume, onChange }: VolumeSliderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* mute icon */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        style={{ color: "var(--ink-3)", flexShrink: 0 }}
      >
        <path d="M3 9v6h4l5 5V4L7 9H3zm10.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
      </svg>
      <input
        type="range"
        aria-label="Volume"
        data-volume-slider
        min={0}
        max={100}
        step={1}
        value={volume}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--ink-1)", cursor: "pointer" }}
      />
      {/* loud icon */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        style={{ color: "var(--ink-3)", flexShrink: 0 }}
      >
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      </svg>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function TransportScrubModal({
  open,
  onClose,
  state,
  appName,
  mediaTitle,
  mediaArtist,
  mediaPosition,
  mediaDuration,
  source,
  artworkUrl,
  volume,
  onPrev = () => {},
  onPlayPause = () => {},
  onNext = () => {},
  onShuffle = () => {},
  onSeek = () => {},
  onVolumeChange = () => {},
}: TransportScrubModalProps) {
  const isPlaying = state === "playing";
  const hasProgress = mediaPosition !== null && mediaDuration !== null && mediaDuration > 0;
  // line-in and TV sources have no seekable position even when data is present.
  const canSeek = source === "streaming" && hasProgress;
  const showNoSeek = source === "line-in" || source === "TV";

  const titleLabel = mediaTitle ?? appName ?? "";

  return (
    <Modal open={open} onClose={onClose} title={titleLabel} width={560} maxHeight={820}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Artwork */}
        {artworkUrl ? (
          <img
            src={artworkUrl}
            alt="Now playing artwork"
            style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 12 }}
          />
        ) : (
          <div
            data-artwork
            style={{
              width: "100%",
              height: 200,
              borderRadius: 12,
              background: "var(--tile-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              style={{ color: "var(--ink-3)" }}
            >
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {/* Title + artist */}
        <div style={{ textAlign: "center" }}>
          {mediaTitle && (
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mediaTitle}
            </div>
          )}
          {(mediaArtist ?? appName) && (
            <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 4 }}>
              {mediaArtist ?? appName}
            </div>
          )}
        </div>

        {/* Scrub bar or no-seek note */}
        {canSeek ? (
          <ScrubBar
            position={mediaPosition as number}
            duration={mediaDuration as number}
            onSeek={onSeek}
          />
        ) : showNoSeek ? (
          <NoSeekNote source={source} />
        ) : null}

        {/* Transport row: shuffle / prev / play-pause / next */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <button type="button" aria-label="Shuffle" onClick={onShuffle} style={transportBtn(36)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zm4.76-.29.76.76L17 8l-2.83-2.83L13 6.34l.76.76-4.17 4.17 1.41 1.41 4.35-4.34zM4 18.59 5.41 20l5.17-5.17-1.41-1.41L4 18.59zm12.41 1.41L20 16.41l-1.41-1.41-1.44 1.44-.76-.76-4.17-4.17-1.41 1.41 4.35 4.35.76.76L14 19l2.41 1z" />
            </svg>
          </button>

          <button type="button" aria-label="Previous" onClick={onPrev} style={transportBtn(40)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={onPlayPause}
            style={transportBtn(56)}
          >
            {isPlaying ? (
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 19h4V5H6zm8-14v14h4V5z" />
              </svg>
            ) : (
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button type="button" aria-label="Next" onClick={onNext} style={transportBtn(40)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 18l8.5-6L6 6zm8.5-6V6H17v12h-2.5z" />
            </svg>
          </button>
        </div>

        {/* Volume slider */}
        <VolumeSlider volume={volume} onChange={onVolumeChange} />
      </div>
    </Modal>
  );
}
