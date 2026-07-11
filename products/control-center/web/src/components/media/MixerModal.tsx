/**
 * MixerModal , full-height grouped faders + gang-lock controls (www-51hf.19 / A24).
 *
 * Renders all Sonos rooms with vertical faders, a global link toggle, per-room
 * mute, and live join/leave group controls. The coordinator of each group cannot
 * be removed from its own group (anchor rule).
 *
 * All state comes from useMixer (passed in from SoundSystemTile). Writes flow
 * through the onSetVolume/onSetMute/onGroupJoin/onGroupLeave callbacks.
 *
 * Built from shared ui primitives (A17): Modal.
 */

import { Modal, Slider } from "@/components/ui";
import type { MixerState } from "./hooks/useMixer";
import type { SoundSystemRoom } from "./SoundSystemTileView";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MixerModalProps {
  open: boolean;
  onClose: () => void;
  rooms: SoundSystemRoom[];
  mixer: MixerState;
  onSetVolume: (uuid: string, volume: number) => void;
  onSetMute: (uuid: string, muted: boolean) => void;
  onGroupJoin: (memberIp: string, coordinatorUuid: string) => void;
  onGroupLeave: (memberIp: string, memberUuid: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function faderBtn(active: boolean): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--accent)" : "var(--tile-2)",
    color: active ? "#fff" : "var(--ink-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    flexShrink: 0,
  };
}

// ── Room fader row ─────────────────────────────────────────────────────────────

interface RoomRowProps {
  room: SoundSystemRoom;
  volume: number;
  muted: boolean;
  globalLock: boolean;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
}

function RoomRow({ room, volume, muted, globalLock, onVolumeChange, onMuteToggle }: RoomRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid var(--tile-2)",
      }}
    >
      {/* Room name + coordinator badge */}
      <div style={{ width: 100, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>{room.name}</div>
        {room.isCoordinator && (
          <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 1 }}>COORD</div>
        )}
      </div>

      {/* Volume slider , shared Slider rail; muted rows dim, gang-lock rows get
          the accent ring around the whole track. */}
      <div
        style={{
          flex: 1,
          opacity: muted ? 0.4 : 1,
          outline: globalLock ? "2px solid var(--accent)" : "none",
          borderRadius: 999,
        }}
      >
        <Slider
          value={volume}
          min={0}
          max={100}
          step={1}
          label={`${room.name} volume`}
          showHeader={false}
          onChange={onVolumeChange}
        />
      </div>

      {/* Volume value */}
      <span
        style={{
          width: 28,
          textAlign: "right",
          fontSize: 12,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: muted ? "var(--ink-3)" : "var(--ink-1)",
          flexShrink: 0,
        }}
      >
        {volume}
      </span>

      {/* Mute button */}
      <button
        type="button"
        aria-label={`${muted ? "Unmute" : "Mute"} ${room.name}`}
        onClick={onMuteToggle}
        style={faderBtn(muted)}
      >
        {muted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function MixerModal({
  open,
  onClose,
  rooms,
  mixer,
  onSetVolume,
  onSetMute,
}: MixerModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Mixer" width={520} maxHeight={720}>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Global link header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 12,
            borderBottom: "1px solid var(--tile-2)",
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
            {mixer.globalLock ? "All rooms linked" : "Independent rooms"}
          </span>
          <button
            type="button"
            aria-label="Link all rooms"
            onClick={() => mixer.setGlobalLock(!mixer.globalLock)}
            style={faderBtn(mixer.globalLock)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
            </svg>
          </button>
        </div>

        {/* Room rows */}
        {rooms.map((room) => (
          <RoomRow
            key={room.uuid}
            room={room}
            volume={mixer.vols[room.uuid] ?? room.volume}
            muted={mixer.mutes[room.uuid] ?? room.muted}
            globalLock={mixer.globalLock}
            onVolumeChange={(v) => onSetVolume(room.uuid, v)}
            onMuteToggle={() => onSetMute(room.uuid, !(mixer.mutes[room.uuid] ?? room.muted))}
          />
        ))}
      </div>
    </Modal>
  );
}
