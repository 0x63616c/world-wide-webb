/**
 * SoundSystemTileView — presentational component for the Sound System 4×3 tile
 * (www-51hf.18 / A22).
 *
 * Renders 5 Sonos rooms as grouped vertical faders. Each fader shows:
 * - Room name
 * - Mono volume value
 * - Muted indicator
 * - Accent ring when globalLock is active (ganged knobs)
 *
 * A global link button toggles link-all. An expand button opens the Mixer modal.
 * Skeleton shimmer while pending/error (A18).
 *
 * Pure presentational — no tRPC. The container (SoundSystemTile) wires everything.
 */

import { Skeleton, Tile, TileHeader } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SoundSystemRoom {
  coordinatorUuid: string;
  /** All member UUIDs in this group (includes coordinator). */
  memberUuids: string[];
  name: string;
  isCoordinator: boolean;
  volume: number;
  muted: boolean;
  transportState: string;
  sourceLabel: string | null;
}

export interface SoundSystemTileViewProps {
  status: "loading" | "error" | "populated";
  rooms: SoundSystemRoom[];
  /** Current per-room volumes from useMixer (live local state). */
  vols: Record<string, number>;
  /** Current per-room mutes from useMixer. */
  mutes: Record<string, boolean>;
  /** Whether all rooms are globally linked. */
  globalLock: boolean;
  onFaderChange: (uuid: string, value: number) => void;
  onToggleGlobalLock: () => void;
  onOpenMixer: () => void;
  /** Open the per-room Source picker, focused on the tapped room. */
  onOpenSource: (uuid: string) => void;
}

// ── Vertical fader ────────────────────────────────────────────────────────────

interface FaderProps {
  room: SoundSystemRoom;
  volume: number;
  muted: boolean;
  ganged: boolean;
  onChange: (value: number) => void;
  onOpenSource: () => void;
}

function VerticalFader({ room, volume, muted, ganged, onChange, onOpenSource }: FaderProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Volume value */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: muted ? "var(--ink-3)" : "var(--ink-1)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {volume}
      </span>

      {/* Vertical range input */}
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <input
          type="range"
          aria-label={`${room.name} volume`}
          data-muted={muted}
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            width: 24,
            height: "100%",
            accentColor: ganged ? "var(--accent)" : "var(--ink-1)",
            cursor: "pointer",
            opacity: muted ? 0.4 : 1,
            outline: ganged ? "2px solid var(--accent)" : "none",
            borderRadius: 4,
          }}
        />
      </div>

      {/* Room name — tap to open the per-room source picker */}
      <button
        type="button"
        aria-label={`${room.name} source`}
        onClick={onOpenSource}
        style={{
          fontSize: 9,
          color: "var(--ink-2)",
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          paddingLeft: 2,
          paddingRight: 2,
          border: "none",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        {room.name}
      </button>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function SoundSystemTileView({
  status,
  rooms,
  vols,
  mutes,
  globalLock,
  onFaderChange,
  onToggleGlobalLock,
  onOpenMixer,
  onOpenSource,
}: SoundSystemTileViewProps) {
  if (status !== "populated") {
    return (
      <Tile padding={12} style={{ gap: 10 }}>
        <TileHeader icon="globe" title="Sound System" />
        <Skeleton w="100%" h={80} />
      </Tile>
    );
  }

  return (
    <Tile padding={10} style={{ gap: 8 }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <TileHeader icon="globe" title="Sound System" />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Global link button */}
          <button
            type="button"
            aria-label="Link all rooms"
            onClick={onToggleGlobalLock}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: globalLock ? "var(--accent)" : "var(--tile-2)",
              color: globalLock ? "#fff" : "var(--ink-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            {/* Chain link icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
            </svg>
          </button>

          {/* Open mixer button */}
          <button
            type="button"
            aria-label="Open mixer"
            onClick={onOpenMixer}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: "var(--tile-2)",
              color: "var(--ink-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            {/* Sliders icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Faders */}
      {rooms.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No speakers</span>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: 6,
            alignItems: "stretch",
            minHeight: 0,
          }}
        >
          {rooms.map((room) => (
            <VerticalFader
              key={room.coordinatorUuid}
              room={room}
              volume={vols[room.coordinatorUuid] ?? room.volume}
              muted={mutes[room.coordinatorUuid] ?? room.muted}
              ganged={globalLock}
              onChange={(value) => onFaderChange(room.coordinatorUuid, value)}
              onOpenSource={() => onOpenSource(room.coordinatorUuid)}
            />
          ))}
        </div>
      )}
    </Tile>
  );
}
