/**
 * DB-authoritative Sonos volume enforcer (www-5mek).
 *
 * device_state.desiredState ({ volume }) is the source of truth for speaker
 * volume; the player is just an actuator , the same model as lights
 * (www-7d5b.2). The dashboard mutation writes desired + a short command window
 * and returns instantly; this 1s cycle reconciles each player:
 *   seed   → first sight copies reported → desired (adopt reality, no push)
 *   push   → drift while the command window is open: the app command owns the
 *            transition, write desired onto the player over UPnP
 *   adopt  → drift after the window: the Sonos app / hardware buttons are
 *            first-class controllers (like wall switches), absorb the change
 * Every speaker is adopt-policy , there is no enforce tier for volume, because
 * fighting a human turning a knob is never right for audio.
 *
 * Volume compares EXACTLY (integer 0-100, round-trips losslessly over UPnP) ,
 * no tolerance band needed, unlike HA color/brightness.
 */

import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import type { DeviceSpeakerState } from "../db/schema";
import { deviceState } from "../db/schema";
import { SonosClient } from "../integrations/sonos";
import { windowOpen } from "./command-window";
import { upsertDesired } from "./desired-state-store";
import { DeviceKind, isSpeakerState } from "./device-state-mapping";
import { heartbeat, runCycle } from "./integration-heartbeat";
import { DESK_RF_BONDED_UUID, TOPOLOGY_ANCHOR_IP } from "./sonos-sound-system-service";

const ENFORCER_INTEGRATION_ID = "sonos-volume-enforcer";
const SPEAKER_DOMAIN = "sonos";

// Backend-only hard volume cap (www-0wbm). Sonos exposes no device-level limit
// over UPnP and HA has no entity for it, so we enforce it here: the enforcer
// only ever actuates min(desired, cap), and external changes above the cap are
// pushed back down within a cycle. Deliberately HIDDEN from the frontend , the
// raw user-requested volume stays in desiredState and is what the panel renders,
// so the cap is invisible (the fader can still read 100, the speaker tops at 90).
export const SPEAKER_MAX_VOLUME = 90;

/** Clamp any volume to the backend cap. */
function capVolume(volume: number): number {
  return Math.min(volume, SPEAKER_MAX_VOLUME);
}

// A speaker row as the reconciler needs it (subset of the deviceState row).
interface ManagedSpeaker {
  id: string;
  deviceIp: string;
  desiredState: DeviceSpeakerState | null;
  desiredUntilUtc: Date | null;
}

/** One player's live reading; volume null when the device could not be read. */
interface SpeakerReading {
  volume: number | null;
  available: boolean;
}

export type SpeakerEnforcementDecision =
  | { kind: "noop" }
  | { kind: "unreachable" }
  | { kind: "seed"; desired: DeviceSpeakerState }
  | { kind: "adopt"; desired: DeviceSpeakerState }
  | { kind: "push"; desired: DeviceSpeakerState }
  // Cap: external volume exceeded SPEAKER_MAX_VOLUME , push the cap onto the
  // speaker but DON'T touch the raw desired (the cap is hidden, not adopted).
  | { kind: "cap"; desired: DeviceSpeakerState };

/** Pure reconcile decision for one speaker. No I/O , the cycle executes the result. */
export function decideSpeakerEnforcement(
  speaker: ManagedSpeaker,
  reading: SpeakerReading,
  now: Date = new Date(),
): SpeakerEnforcementDecision {
  // Unreachable: can't read truth, so can't push or adopt. Desired survives the
  // outage , intent is never wiped by unreachability.
  if (!reading.available || reading.volume == null) return { kind: "unreachable" };
  const reported: DeviceSpeakerState = { volume: reading.volume };

  // Seed keeps reality RAW (even above the cap); the cap branch below pushes it
  // down on the next cycle once a desired exists to compare against.
  if (speaker.desiredState == null) return { kind: "seed", desired: reported };

  // Convergence is judged against the CLAMPED desired: a desired of 100 with the
  // speaker sitting at the 90 cap is "converged" (noop), so an above-cap desired
  // never causes an endless push loop.
  const target = capVolume(speaker.desiredState.volume);
  if (reported.volume === target) return { kind: "noop" };

  if (windowOpen(speaker, now)) return { kind: "push", desired: { volume: target } };

  // Outside the window: an external change at/below the cap is adopted as the new
  // intent (Sonos app / hardware buttons win). Above the cap it is NOT honored ,
  // push the cap back down and leave the raw desired alone.
  if (reported.volume > SPEAKER_MAX_VOLUME) {
    return { kind: "cap", desired: { volume: SPEAKER_MAX_VOLUME } };
  }
  return { kind: "adopt", desired: reported };
}

/** Stable Stripe-style row id derived from the player's static LAN IP. */
function speakerDeviceId(deviceIp: string): string {
  return `spk_${deviceIp.replaceAll(".", "-")}`;
}

/**
 * The dashboard mutation path: accept the command instantly by upserting
 * desired + a command window, NEVER touching the speaker , the enforcer pushes
 * it within a cycle. THROWS on DB failure (the write is this mutation's only
 * effect, so a swallowed error would be fabricated success).
 */
export async function setSpeakerDesiredVolume({
  deviceIp,
  volume,
}: {
  deviceIp: string;
  volume: number;
}): Promise<void> {
  const desired: DeviceSpeakerState = { volume };
  // The store owns the upsert + command-window stamp and throws on DB failure
  // (the write is this mutation's only effect, so a swallow is fabricated success).
  await upsertDesired({
    id: speakerDeviceId(deviceIp),
    kind: DeviceKind.Speaker,
    entityId: deviceIp,
    domain: SPEAKER_DOMAIN,
    // Real label (zone name) is unknown here; the enforcer refreshes it from
    // topology on its next cycle.
    label: deviceIp,
    desired,
  });
}

export async function runSonosVolumeEnforcerCycle(): Promise<void> {
  await runCycle(heartbeat(ENFORCER_INTEGRATION_ID), "sonos-volume-enforcer", reconcile);
}

interface LivePlayer {
  ip: string;
  zoneName: string;
  reading: SpeakerReading;
}

/** Topology + per-player volume, read fresh every cycle (grouping is volatile). */
async function fetchPlayers(): Promise<LivePlayer[]> {
  const groups = await new SonosClient(TOPOLOGY_ANCHOR_IP).getZoneGroupState();
  const seen = new Set<string>();
  const members = groups
    .flatMap((g) => g.members)
    .filter((m) => m.uuid !== DESK_RF_BONDED_UUID)
    .filter((m) => (seen.has(m.ip) ? false : seen.add(m.ip)));

  return Promise.all(
    members.map(async (m): Promise<LivePlayer> => {
      try {
        const volume = await new SonosClient(m.ip).getVolume();
        return { ip: m.ip, zoneName: m.zoneName, reading: { volume, available: true } };
      } catch {
        // One dead player must not fail the whole cycle for its siblings.
        return { ip: m.ip, zoneName: m.zoneName, reading: { volume: null, available: false } };
      }
    }),
  );
}

async function reconcile(): Promise<void> {
  const players = await fetchPlayers();
  const rows = await db.select().from(deviceState).where(eq(deviceState.kind, DeviceKind.Speaker));
  const rowByIp = new Map(rows.map((r) => [r.entityId, r]));
  const now = new Date();

  for (const player of players) {
    const row = rowByIp.get(player.ip);
    rowByIp.delete(player.ip);

    if (!row) {
      // First sight with a readable volume: insert the seed row (desired =
      // reported, no push). Unreadable first sight: nothing to seed from.
      if (player.reading.volume == null) continue;
      const reported: DeviceSpeakerState = { volume: player.reading.volume };
      await db.insert(deviceState).values({
        id: speakerDeviceId(player.ip),
        kind: DeviceKind.Speaker,
        entityId: player.ip,
        domain: SPEAKER_DOMAIN,
        label: player.zoneName,
        reportedState: reported,
        reportedAtUtc: now,
        desiredState: reported,
        desiredAtUtc: now,
        available: true,
      });
      continue;
    }

    const speaker: ManagedSpeaker = {
      id: row.id,
      deviceIp: row.entityId,
      desiredState: isSpeakerState(row.desiredState) ? row.desiredState : null,
      desiredUntilUtc: row.desiredUntilUtc ?? null,
    };
    const decision = decideSpeakerEnforcement(speaker, player.reading, now);
    await applyDecision(speaker, decision, player, now);
  }

  // Rows for players that vanished from topology entirely: honest availability.
  for (const row of rowByIp.values()) {
    if (!row.available) continue;
    await db
      .update(deviceState)
      .set({ available: false, updatedAtUtc: now })
      .where(eq(deviceState.id, row.id));
  }
}

async function applyDecision(
  speaker: ManagedSpeaker,
  decision: SpeakerEnforcementDecision,
  player: LivePlayer,
  now: Date,
): Promise<void> {
  const reported: DeviceSpeakerState | null =
    player.reading.volume == null ? null : { volume: player.reading.volume };
  // Refreshed every cycle: the panel reads reported as the overlay base, and the
  // label tracks the player's zone name (the mutation seeds it as a bare IP).
  const baseFields = {
    reportedState: reported,
    reportedAtUtc: now,
    label: player.zoneName,
    updatedAtUtc: now,
  };

  switch (decision.kind) {
    case "unreachable": {
      await db
        .update(deviceState)
        .set({ ...baseFields, available: false })
        .where(eq(deviceState.id, speaker.id));
      return;
    }
    case "seed":
    case "adopt": {
      if (decision.kind === "adopt") {
        getLogger().debug(
          { deviceIp: speaker.deviceIp, adoptedVolume: decision.desired.volume },
          "sonos-volume-enforcer adopted external volume",
        );
      }
      await db
        .update(deviceState)
        .set({
          ...baseFields,
          desiredState: decision.desired,
          desiredAtUtc: now,
          available: true,
        })
        .where(eq(deviceState.id, speaker.id));
      return;
    }
    case "push":
    case "cap": {
      getLogger().debug(
        {
          deviceIp: speaker.deviceIp,
          volume: decision.desired.volume,
          capped: decision.kind === "cap",
        },
        decision.kind === "cap"
          ? "sonos-volume-enforcer capping external over-volume"
          : "sonos-volume-enforcer pushing desired volume",
      );
      // Both actuate the speaker and refresh reported/availability; neither writes
      // desiredState (push keeps the raw desired, cap deliberately hides itself).
      await new SonosClient(speaker.deviceIp).setVolume(decision.desired.volume);
      await db
        .update(deviceState)
        .set({ ...baseFields, available: true })
        .where(eq(deviceState.id, speaker.id));
      return;
    }
    case "noop": {
      await db
        .update(deviceState)
        .set({ ...baseFields, available: true })
        .where(eq(deviceState.id, speaker.id));
      return;
    }
  }
}
