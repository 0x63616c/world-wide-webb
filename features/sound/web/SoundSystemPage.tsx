/**
 * SoundSystemPage , the full-page Sound System detail (opened by tapping the
 * tile). One row per Sonos room with a horizontal fader flanked by −/+
 * steppers (grainy one-point control), mute, and the room's group moves; an
 * action bar above with the two one-tap groupings (everything to the Desk,
 * everything to the TV) and the calibration controls (Calibrate, Clear,
 * Lock) ported from the Hammerspoon Sonos panel.
 *
 * Presentational over `SoundControls`: the container (web/wiring/sound.tsx)
 * hands it the hook's result so tests can drive it with a plain object.
 */
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Alert, Button } from "@/components/ui";
import { DESK_ROOM_NAME, type SoundControls, type SoundRoom } from "./hooks/useSoundControls";

export interface SoundSystemPageProps {
  controls: SoundControls;
  diagnostics: { queriedAt: string; message: string } | null;
}

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const ACTION: React.CSSProperties = { width: "auto", height: 38, fontSize: 14, padding: "0 14px" };

function transportLabel(room: SoundRoom): string {
  if (room.availability === "unavailable") return "Unavailable";
  if (room.availability === "unknown") return "Unknown";
  const state =
    room.transportState === "PLAYING"
      ? "Playing"
      : room.transportState === "PAUSED_PLAYBACK"
        ? "Paused"
        : "Idle";
  return room.sourceLabel ? `${state} · ${room.sourceLabel}` : state;
}

// ── Action bar ────────────────────────────────────────────────────────────────

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={LABEL}>{label}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function LockButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label="Lock all rooms"
      aria-pressed={on}
      onClick={onToggle}
      style={{
        ...ACTION,
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
        fontFamily: "var(--ui)",
        fontWeight: 600,
        cursor: "pointer",
        border: on ? "1px solid var(--acc-line)" : "1px solid var(--hair-2)",
        background: on ? "var(--acc-dim)" : "transparent",
        color: on ? "var(--acc)" : "var(--ink)",
      }}
    >
      <Icon name={on ? "lock" : "unlock"} s={15} c={on ? "var(--acc)" : "var(--ink-2)"} />
      {on ? "Locked" : "Lock"}
    </button>
  );
}

function ActionBar({ controls }: { controls: SoundControls }) {
  const { joinAllToDesk, joinAllToTv, calibrate, clearCalibration, calibratedCount, rooms } =
    controls;
  const deskLabel = joinAllToDesk.isPending
    ? `Joining ${joinAllToDesk.pending.length}…`
    : !joinAllToDesk.room
      ? `${DESK_ROOM_NAME} unavailable`
      : joinAllToDesk.pending.length === 0
        ? `All on ${DESK_ROOM_NAME}`
        : `Join all to ${DESK_ROOM_NAME}`;
  const tvLabel = joinAllToTv.isPending
    ? "Switching to TV…"
    : !joinAllToTv.room
      ? "TV unavailable"
      : "Join all to TV";
  const total = rooms.length;
  const calibrationSummary =
    calibratedCount === 0
      ? "Not calibrated · showing raw volume"
      : calibratedCount === total
        ? "All rooms calibrated · volumes are % of baseline"
        : `${calibratedCount} of ${total} rooms calibrated · volumes are % of baseline`;

  return (
    <section
      style={{
        display: "grid",
        gap: 16,
        padding: "16px 18px",
        border: "1px solid var(--hair)",
        borderRadius: 14,
        background: "var(--tile-2)",
      }}
    >
      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ActionGroup label="Grouping">
          <Button
            type="button"
            style={ACTION}
            loading={joinAllToDesk.isPending}
            disabled={!joinAllToDesk.room || joinAllToDesk.pending.length === 0}
            onClick={joinAllToDesk.run}
          >
            {deskLabel}
          </Button>
          <Button
            type="button"
            style={ACTION}
            loading={joinAllToTv.isPending}
            disabled={!joinAllToTv.room}
            onClick={joinAllToTv.run}
          >
            {tvLabel}
          </Button>
        </ActionGroup>
        <ActionGroup label="Calibration">
          <Button
            type="button"
            variant="ghost"
            style={ACTION}
            loading={calibrate.isPending}
            disabled={total === 0}
            onClick={calibrate.run}
          >
            {calibrate.isPending ? "Calibrating…" : "Calibrate"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            style={ACTION}
            loading={clearCalibration.isPending}
            disabled={calibratedCount === 0}
            onClick={clearCalibration.run}
          >
            {clearCalibration.isPending ? "Clearing…" : "Clear calibration"}
          </Button>
          <LockButton
            on={controls.globalLock}
            onToggle={() => controls.setGlobalLock(!controls.globalLock)}
          />
        </ActionGroup>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{calibrationSummary}</span>
        {controls.notice && (
          <span role="status" style={{ fontSize: 13, color: "var(--acc)" }}>
            {controls.notice}
          </span>
        )}
      </div>
    </section>
  );
}

// ── Room row ──────────────────────────────────────────────────────────────────

function StepBtn({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "plus" | "minus";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      style={{
        width: 40,
        height: 40,
        flex: "0 0 auto",
        borderRadius: 10,
        display: "grid",
        placeItems: "center",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        border: "1px solid var(--hair-2)",
        background: "var(--tile-2)",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon name={icon} s={16} c="var(--ink)" />
    </button>
  );
}

interface RoomRowProps {
  room: SoundRoom;
  rooms: SoundRoom[];
  controls: SoundControls;
}

function RoomRow({ room, rooms, controls }: RoomRowProps) {
  const [leader, setLeader] = useState<string>("");
  const volume = controls.vols[room.uuid] ?? room.volume;
  const muted = controls.mutes[room.uuid] ?? room.muted;
  const online = room.availability === "available";
  const active = room.transportState === "PLAYING";
  const calibrated = room.baseline !== null;
  const leaders = rooms.filter((c) => c.uuid !== room.uuid && c.availability === "available");
  const leaderValue = leader || leaders[0]?.uuid || "";
  const followingName = room.isCoordinator
    ? null
    : (rooms.find((c) => c.uuid === room.coordinatorUuid)?.name ?? room.groupStatus);
  const groupText = followingName ? `Following ${followingName}` : "Standalone";
  const pct = Math.max(0, Math.min(100, volume));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr auto",
        alignItems: "center",
        gap: 20,
        padding: "14px 18px",
        border: active ? "1px solid var(--acc-line)" : "1px solid var(--hair)",
        background: active ? "var(--acc-dim)" : "transparent",
        borderRadius: 14,
        opacity: online ? 1 : 0.55,
      }}
    >
      {/* Name + state */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{ fontWeight: 650, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {room.name}
          </span>
          {calibrated && (
            <span
              title={`Baseline ${room.baseline}`}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "var(--acc)",
                flex: "0 0 auto",
              }}
            />
          )}
        </div>
        <div style={{ marginTop: 3, fontSize: 13, color: "var(--ink-3)" }}>
          {transportLabel(room)}
        </div>
        <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-3)" }}>{groupText}</div>
      </div>

      {/* − slider + value mute */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <StepBtn
          icon="minus"
          label={`${room.name} down`}
          disabled={!online}
          onPress={() => controls.stepVolume(room.uuid, -1)}
        />
        <div style={{ flex: 1, minWidth: 0, opacity: muted ? 0.45 : 1 }}>
          <input
            className="range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            disabled={!online}
            aria-label={`${room.name} volume`}
            onChange={(e) => controls.setVolume(room.uuid, Number(e.target.value))}
            style={{ "--p": `${pct}%`, width: "100%" } as React.CSSProperties}
          />
        </div>
        <StepBtn
          icon="plus"
          label={`${room.name} up`}
          disabled={!online}
          onPress={() => controls.stepVolume(room.uuid, 1)}
        />
        <span
          className="mono"
          data-testid={`vol-${room.uuid}`}
          style={{
            width: 52,
            textAlign: "right",
            fontSize: 15,
            fontVariantNumeric: "tabular-nums",
            color: muted ? "var(--ink-3)" : "var(--ink)",
          }}
        >
          {volume}
          {calibrated ? "%" : ""}
        </span>
        <button
          type="button"
          aria-label={muted ? `Unmute ${room.name}` : `Mute ${room.name}`}
          aria-pressed={muted}
          disabled={!online}
          onClick={() => controls.toggleMute(room.uuid)}
          style={{
            height: 34,
            padding: "0 12px",
            borderRadius: 9,
            fontFamily: "var(--ui)",
            fontSize: 12,
            fontWeight: 600,
            cursor: online ? "pointer" : "default",
            border: muted ? "1px solid var(--acc-line)" : "1px solid var(--hair-2)",
            background: muted ? "var(--acc-dim)" : "transparent",
            color: muted ? "var(--acc)" : "var(--ink-2)",
          }}
        >
          {muted ? "Muted" : "Mute"}
        </button>
      </div>

      {/* Group moves */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {!room.isCoordinator && (
          <Button
            variant="ghost"
            type="button"
            style={{ ...ACTION, height: 34, fontSize: 13 }}
            onClick={() => controls.leave(room)}
          >
            Make standalone
          </Button>
        )}
        {leaders.length > 0 && online && (
          <>
            <select
              aria-label={`Group ${room.name} with`}
              value={leaderValue}
              onChange={(event) => setLeader(event.target.value)}
              style={{ height: 34, borderRadius: 9, fontSize: 13 }}
            >
              {leaders.map((l) => (
                <option key={l.uuid} value={l.uuid}>
                  {l.name}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              type="button"
              style={{ ...ACTION, height: 34, fontSize: 13 }}
              onClick={() => controls.join(room, leaderValue)}
            >
              Join
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SoundSystemPage({ controls, diagnostics }: SoundSystemPageProps) {
  const { rooms } = controls;
  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 20 }}>
      <ActionBar controls={controls} />

      {controls.queryError && (
        <Alert title="Home Assistant is unavailable">{controls.queryError}</Alert>
      )}
      {controls.error && <Alert title="Audio command failed">{controls.error}</Alert>}

      <section style={{ display: "grid", gap: 10 }}>
        <span style={LABEL}>Rooms</span>
        {rooms.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No Sonos rooms reported.</div>
        ) : (
          rooms.map((room) => (
            <RoomRow key={room.uuid} room={room} rooms={rooms} controls={controls} />
          ))
        )}
      </section>

      {diagnostics && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 12 }}>
          <span>Home Assistant → Sonos</span>
          <span>·</span>
          <span>{diagnostics.message}</span>
          <span>·</span>
          <span>Snapshot {new Date(diagnostics.queriedAt).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
}
