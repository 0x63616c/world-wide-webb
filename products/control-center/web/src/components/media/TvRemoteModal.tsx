/**
 * TvRemoteModal , D-pad remote control modal for the TV (www-51hf.17).
 *
 * Renders a now-playing strip, playback keys (prev/play-pause/next), and a
 * D-pad (up/down/left/right + center OK, menu/back, home, power) all wired to
 * callbacks that the container maps to tvRemote mutations.
 *
 * Mute is intentionally absent , the tvRemote mutation has no mute command, so
 * an explicit note makes that clear to users rather than hiding the absence.
 *
 * All visible state is driven by props; zero tRPC dependencies.
 * Built exclusively from shared ui primitives (A17): Modal, Skeleton.
 */

import { Modal } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TvRemoteModalProps {
  open: boolean;
  onClose: () => void;
  // now-playing strip
  state: string;
  appName: string | null;
  mediaTitle: string | null;
  mediaArtist: string | null;
  artworkUrl: string | null;
  // transport callbacks
  onPrev?: () => void;
  onPlayPause?: () => void;
  onNext?: () => void;
  // D-pad callbacks
  onUp?: () => void;
  onDown?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onOk?: () => void;
  onMenu?: () => void;
  onHome?: () => void;
  onPower?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function remoteBtn(size: number, accent = false): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    background: accent ? "var(--ink-1)" : "var(--tile-2)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: accent ? "var(--tile-bg)" : "var(--ink-1)",
    padding: 0,
    font: "inherit",
    flexShrink: 0,
  };
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

// ── D-pad grid ────────────────────────────────────────────────────────────────
// Five buttons in a plus arrangement: Up top, Down bottom, Left, Right, OK center.

interface DPadProps {
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
  onOk: () => void;
}

function DPad({ onUp, onDown, onLeft, onRight, onOk }: DPadProps) {
  const btnSize = 52;
  const gap = 8;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${btnSize}px ${btnSize}px ${btnSize}px`,
        gridTemplateRows: `${btnSize}px ${btnSize}px ${btnSize}px`,
        gap,
        width: "fit-content",
        margin: "0 auto",
      }}
    >
      {/* Row 0: [empty] Up [empty] */}
      <span />
      <button type="button" aria-label="Up" onClick={onUp} style={remoteBtn(btnSize)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
        </svg>
      </button>
      <span />
      {/* Row 1: Left OK Right */}
      <button type="button" aria-label="Left" onClick={onLeft} style={remoteBtn(btnSize)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
        </svg>
      </button>
      <button type="button" aria-label="OK" onClick={onOk} style={remoteBtn(btnSize, true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
      </button>
      <button type="button" aria-label="Right" onClick={onRight} style={remoteBtn(btnSize)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z" />
        </svg>
      </button>
      {/* Row 2: [empty] Down [empty] */}
      <span />
      <button type="button" aria-label="Down" onClick={onDown} style={remoteBtn(btnSize)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
        </svg>
      </button>
      <span />
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function TvRemoteModal({
  open,
  onClose,
  state,
  appName,
  mediaTitle,
  mediaArtist,
  artworkUrl,
  onPrev = () => {},
  onPlayPause = () => {},
  onNext = () => {},
  onUp = () => {},
  onDown = () => {},
  onLeft = () => {},
  onRight = () => {},
  onOk = () => {},
  onMenu = () => {},
  onHome = () => {},
  onPower = () => {},
}: TvRemoteModalProps) {
  const isPlaying = state === "playing";
  const titleLabel = mediaTitle ?? appName ?? "TV Remote";

  return (
    <Modal open={open} onClose={onClose} title="TV Remote" width={440} maxHeight={820}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Now-playing strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Artwork thumbnail */}
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt="Now playing artwork"
              style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <div
              data-artwork
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                background: "var(--tile-2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                style={{ color: "var(--ink-3)" }}
              >
                <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM8 15c0-1.66 1.34-3 3-3 .35 0 .69.07 1 .18V6h5v2h-3v7.03A2.997 2.997 0 0 1 11 18c-1.66 0-3-1.34-3-3z" />
              </svg>
            </div>
          )}
          {/* Title + app */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--ink-1)",
              }}
            >
              {titleLabel}
            </div>
            {(mediaArtist ?? appName) && (
              <div
                style={{
                  fontSize: 13,
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
        </div>

        {/* Playback transport row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <button type="button" aria-label="Previous" onClick={onPrev} style={transportBtn(40)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={onPlayPause}
            style={transportBtn(52)}
          >
            {isPlaying ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 19h4V5H6zm8-14v14h4V5z" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
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

        {/* D-pad */}
        <DPad onUp={onUp} onDown={onDown} onLeft={onLeft} onRight={onRight} onOk={onOk} />

        {/* Utility row: Menu/Back, Home, Power */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <button type="button" aria-label="Menu / Back" onClick={onMenu} style={transportBtn(44)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>

          <button type="button" aria-label="Home" onClick={onHome} style={transportBtn(44)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
          </button>

          <button type="button" aria-label="Power" onClick={onPower} style={transportBtn(44)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.28 1.09-4.3 2.58-5.42L6.17 5.17A8.932 8.932 0 0 0 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9a8.932 8.932 0 0 0-3.17-6.83z" />
            </svg>
          </button>
        </div>

        {/* Explicit no-mute note (tvRemote has no mute command) */}
        <div
          data-no-mute
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--tile-2)",
            color: "var(--ink-3)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Volume control unavailable , use TV or receiver hardware buttons to adjust volume.
        </div>
      </div>
    </Modal>
  );
}
