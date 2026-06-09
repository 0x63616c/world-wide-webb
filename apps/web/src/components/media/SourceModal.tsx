/**
 * SourceModal — per-room source picker (CC-51hf.20 / A25).
 *
 * Renders one card per Sonos room with source chips: Line-in, TV, Spotify,
 * AirPlay, Idle. Selecting a chip writes the room's source via a media mutation.
 *
 * Built from shared ui primitives (A17): Modal, Chip.
 */

import { Modal } from "@/components/ui";
import type { SoundSystemRoom } from "./SoundSystemTileView";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RoomSource = "Line-in" | "TV" | "Spotify" | "AirPlay" | "Idle";

export interface SourceModalProps {
  open: boolean;
  onClose: () => void;
  rooms: SoundSystemRoom[];
  /** Called with the room's coordinator UUID and the chosen source. */
  onSetSource?: (coordinatorUuid: string, source: RoomSource) => void;
}

const SOURCES: RoomSource[] = ["Line-in", "TV", "Spotify", "AirPlay", "Idle"];

// ── Room card ─────────────────────────────────────────────────────────────────

interface RoomCardProps {
  room: SoundSystemRoom;
  onSelectSource: (source: RoomSource) => void;
}

function RoomCard({ room, onSelectSource }: RoomCardProps) {
  const isGrouped = room.memberUuids.length > 1;

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--tile-2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Room name + GROUPED badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>{room.name}</span>
        {isGrouped && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              padding: "1px 5px",
              borderRadius: 4,
              letterSpacing: "0.04em",
            }}
          >
            GROUPED
          </span>
        )}
      </div>

      {/* Source chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SOURCES.map((source) => (
          <button
            key={source}
            type="button"
            aria-label={`Set ${room.name} to ${source}`}
            onClick={() => onSelectSource(source)}
            style={{
              padding: "4px 10px",
              borderRadius: 20,
              border: "1px solid var(--tile-3)",
              background: "transparent",
              color: "var(--ink-2)",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {source}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function SourceModal({ open, onClose, rooms, onSetSource }: SourceModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Sources" width={520} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rooms.map((room) => (
          <RoomCard
            key={room.coordinatorUuid}
            room={room}
            onSelectSource={(source) => onSetSource?.(room.coordinatorUuid, source)}
          />
        ))}
      </div>
    </Modal>
  );
}
