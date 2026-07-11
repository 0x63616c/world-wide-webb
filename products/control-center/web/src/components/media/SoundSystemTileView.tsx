/**
 * SoundSystemTileView , presentational Sound System 4×3 tile.
 *
 * Chosen design (www-xlyf , "Filled group panel: Line-in boxed, lock in its cap"):
 * a speaker header with a global-lock button, then two side-by-side group panels.
 * Rooms that are playing land in an ACCENT-boxed "active" panel (a group lock sits
 * in its cap and the group coordinator carries a COORD sublabel); idle rooms land
 * in a plain hairline panel. When one side is empty the other spans full width.
 *
 * Faders are custom-drawn and pointer/keyboard draggable , a native range can't be
 * styled to the design and (www-tdad) overflows the card in vertical writing mode.
 *
 * Pure presentational , no tRPC. The container (SoundSystemTile) wires the data.
 */

import { Icon } from "@/components/Icon";
import { Skeleton, Slider, Tile, TileHeader } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SoundSystemRoom {
  /** This player's own identity key (matches the vols/mutes keys from useMixer). */
  uuid: string;
  coordinatorUuid: string;
  /** All member UUIDs in this room's Sonos group (includes the coordinator). */
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
  /** Current per-room volumes from useMixer (keyed by room uuid). */
  vols: Record<string, number>;
  /** Current per-room mutes from useMixer (keyed by room uuid). */
  mutes: Record<string, boolean>;
  /** Whether all rooms are globally ganged together. */
  globalLock: boolean;
  /** Whether the active group's faders are ganged together. */
  groupLock: boolean;
  onFaderChange: (uuid: string, value: number) => void;
  onToggleGlobalLock: () => void;
  onToggleGroupLock: () => void;
  /** Open the full Mixer modal (group join/leave, mute). */
  onOpenMixer: () => void;
  /** Open the per-room Source picker, focused on the tapped room. */
  onOpenSource: (uuid: string) => void;
}

/** A room is "active" (boxed in the accent panel) when its group is playing. */
function isActive(room: SoundSystemRoom): boolean {
  return room.transportState === "PLAYING" || room.transportState === "PAUSED_PLAYBACK";
}

/**
 * UUIDs to mark as group coordinators (blue name). A room qualifies only when it
 * coordinates a group with 2+ VISIBLE rooms , counted from the rendered rooms by
 * shared coordinatorUuid, NOT from memberUuids (which still includes the hidden
 * bonded Desk RF satellite, so a visually-solo Desk would wrongly mark) (www-a5rl).
 */
function coordinatorUuids(rooms: SoundSystemRoom[]): Set<string> {
  const visibleCount = new Map<string, number>();
  for (const r of rooms) {
    visibleCount.set(r.coordinatorUuid, (visibleCount.get(r.coordinatorUuid) ?? 0) + 1);
  }
  return new Set(
    rooms
      .filter((r) => r.isCoordinator && (visibleCount.get(r.coordinatorUuid) ?? 0) > 1)
      .map((r) => r.uuid),
  );
}

function clampVolume(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

// ── Fader ─────────────────────────────────────────────────────────────────────

interface FaderProps {
  room: SoundSystemRoom;
  volume: number;
  muted: boolean;
  /** Accent (active group) styling vs. dim (idle group) styling. */
  accent: boolean;
  /** Ganged with others , draw the accent ring on the thumb. */
  linked: boolean;
  /** Group coordinator of a real multi-room group , render the name blue (www-a5rl). */
  coord: boolean;
  onChange: (value: number) => void;
  onOpenSource: () => void;
}

function Fader({ room, volume, muted, accent, linked, coord, onChange, onOpenSource }: FaderProps) {
  const valueColor = muted ? "var(--ink-3)" : accent ? "var(--ink)" : "var(--ink-2)";

  return (
    <div
      data-muted={muted}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 9,
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Volume value */}
      <span
        className="mono"
        style={{ fontSize: 13, color: valueColor, fontVariantNumeric: "tabular-nums" }}
      >
        {volume}
      </span>

      {/* Vertical fader , the shared Slider rotated (auto-length fills the tile).
          Idle groups + muted rooms dim the whole control rather than swapping to a
          grey rail; ganged rooms get the accent ring around the track (www-a5rl). */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: 40,
          display: "flex",
          justifyContent: "center",
          opacity: muted ? 0.45 : accent ? 1 : 0.6,
          outline: linked ? "2px solid var(--acc)" : "none",
          borderRadius: 999,
        }}
      >
        <Slider
          value={volume}
          min={0}
          max={100}
          label={`${room.name} volume`}
          showHeader={false}
          orientation="vertical"
          onChange={(v) => onChange(clampVolume(v))}
        />
      </div>

      {/* Room name , tap to open the per-room source picker (A25/A31). A group
          coordinator's name is blue (www-a5rl): it replaces the old COORD sublabel. */}
      <div style={{ textAlign: "center", lineHeight: 1.1, maxWidth: "100%" }}>
        <button
          type="button"
          aria-label={`${room.name} source`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenSource();
          }}
          style={{
            display: "block",
            maxWidth: "100%",
            fontSize: 11,
            fontWeight: 600,
            color: coord ? "var(--acc)" : accent && !muted ? "var(--ink)" : "var(--ink-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {room.name}
        </button>
      </div>
    </div>
  );
}

// ── Group panel ───────────────────────────────────────────────────────────────

interface GroupPanelProps {
  label: string;
  rooms: SoundSystemRoom[];
  /** Accent (active) panel = boxed in accent; otherwise a plain hairline panel. */
  accent: boolean;
  /** Flex weight , proportional to room count so faders stay evenly sized. */
  flex: number;
  vols: Record<string, number>;
  mutes: Record<string, boolean>;
  /** Per-fader linked flag (gang ring). */
  linked: boolean;
  /** UUIDs of group coordinators to blue-mark (www-a5rl). */
  coordUuids: Set<string>;
  /** Group-lock control , shown in the cap of the accent panel only. */
  lock?: { on: boolean; dimmed: boolean; onToggle: () => void };
  onFaderChange: (uuid: string, value: number) => void;
  onOpenSource: (uuid: string) => void;
}

function GroupPanel({
  label,
  rooms,
  accent,
  flex,
  vols,
  mutes,
  linked,
  coordUuids,
  lock,
  onFaderChange,
  onOpenSource,
}: GroupPanelProps) {
  return (
    <div
      style={{
        flex: `${flex} 1 0`,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        padding: "10px 12px 12px",
        border: accent ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
        background: accent ? "var(--acc-dim)" : "transparent",
      }}
    >
      {/* Cap: group label + optional lock */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          height: 26,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {lock && (
          <button
            type="button"
            aria-label="Lock group"
            aria-pressed={lock.on}
            onClick={(e) => {
              e.stopPropagation();
              if (!lock.dimmed) lock.onToggle();
            }}
            style={{
              flex: "0 0 auto",
              width: 26,
              height: 26,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              padding: 0,
              cursor: lock.dimmed ? "default" : "pointer",
              opacity: lock.dimmed ? 0.6 : 1,
              border:
                lock.on || lock.dimmed ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
              background: lock.on || lock.dimmed ? "var(--acc-dim)" : "var(--tile-2)",
            }}
          >
            <Icon
              name={lock.on || lock.dimmed ? "lock" : "unlock"}
              s={13}
              c={lock.on || lock.dimmed ? "var(--acc)" : "var(--ink-3)"}
            />
          </button>
        )}
      </div>

      {/* Faders */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          justifyContent: "space-around",
          gap: 4,
        }}
      >
        {rooms.map((room) => (
          <Fader
            key={room.uuid}
            room={room}
            volume={vols[room.uuid] ?? room.volume}
            muted={mutes[room.uuid] ?? room.muted}
            accent={accent}
            linked={linked}
            coord={coordUuids.has(room.uuid)}
            onChange={(value) => onFaderChange(room.uuid, value)}
            onOpenSource={() => onOpenSource(room.uuid)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function GlobalLockBtn({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Link all rooms"
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: "pointer",
        border: on ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
        background: on ? "var(--acc-dim)" : "var(--tile-2)",
      }}
    >
      <Icon name={on ? "lock" : "unlock"} s={18} c={on ? "var(--acc)" : "var(--ink-2)"} />
    </button>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function SoundSystemTileView({
  status,
  rooms,
  vols,
  mutes,
  globalLock,
  groupLock,
  onFaderChange,
  onToggleGlobalLock,
  onToggleGroupLock,
  onOpenMixer,
  onOpenSource,
}: SoundSystemTileViewProps) {
  // The tile owns its tap surface: tapping it (outside the faders/buttons) opens
  // the full Mixer modal , the canonical `ownsTap` detail-modal pattern.
  if (status !== "populated") {
    return (
      <Tile padding={18} style={{ gap: 0 }} onClick={onOpenMixer}>
        <TileHeader
          icon="speaker"
          title="Sound System"
          right={<GlobalLockBtn on={false} onToggle={onToggleGlobalLock} />}
        />
        <Skeleton w="100%" h={120} />
      </Tile>
    );
  }

  const active = rooms.filter(isActive);
  const idle = rooms.filter((r) => !isActive(r));
  // The accent panel's cap reflects the real source when known, else its state.
  const activeLabel = active.find((r) => r.sourceLabel)?.sourceLabel ?? "Playing";
  const coordUuids = coordinatorUuids(rooms);
  // The group lock gangs the active panel's faders , meaningless with a single
  // fader, so hide it when only one room is active (www-a5rl).
  const showGroupLock = active.length > 1;

  return (
    <Tile padding={18} style={{ gap: 0 }} onClick={onOpenMixer}>
      <TileHeader
        icon="speaker"
        title="Sound System"
        right={<GlobalLockBtn on={globalLock} onToggle={onToggleGlobalLock} />}
      />

      {rooms.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No speakers</span>
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 10, alignItems: "stretch" }}>
          {active.length > 0 && (
            <GroupPanel
              label={activeLabel}
              rooms={active}
              accent
              flex={active.length}
              vols={vols}
              mutes={mutes}
              linked={globalLock || groupLock}
              coordUuids={coordUuids}
              lock={
                showGroupLock
                  ? { on: groupLock, dimmed: globalLock, onToggle: onToggleGroupLock }
                  : undefined
              }
              onFaderChange={onFaderChange}
              onOpenSource={onOpenSource}
            />
          )}
          {idle.length > 0 && (
            <GroupPanel
              label="Idle"
              rooms={idle}
              accent={false}
              flex={idle.length}
              vols={vols}
              mutes={mutes}
              linked={globalLock}
              coordUuids={coordUuids}
              onFaderChange={onFaderChange}
              onOpenSource={onOpenSource}
            />
          )}
        </div>
      )}
    </Tile>
  );
}
