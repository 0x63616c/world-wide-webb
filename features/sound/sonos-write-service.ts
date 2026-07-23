/**
 * Sonos write mutations service (www-51hf.10).
 *
 * Thin wrappers over SonosClient that expose the write operations needed by
 * the tRPC media router mutations. Each function THROWS on any SonosClient
 * error , callers never receive fabricated success (A3).
 *
 * URI patterns used:
 *   Group join:    x-rincon:<COORDINATOR_UUID>
 *   Line-in:       x-rincon-stream:<SOURCE_UUID>:0
 *   TV-grab:       x-sonos-htastream:<BEAM_UUID>:spdif
 */

import { SonosClient } from "@www/core";

/** Sets the mute state on a single device. THROWS on any failure. */
export async function sonosSetMute({
  deviceIp,
  muted,
}: {
  deviceIp: string;
  muted: boolean;
}): Promise<void> {
  const client = new SonosClient(deviceIp);
  await client.setMute(muted);
}

/** Sends a transport command to a room's coordinator device. THROWS on any failure. */
export async function sonosTransport({
  coordinatorIp,
  command,
}: {
  coordinatorIp: string;
  command: "play" | "pause" | "next" | "previous";
}): Promise<void> {
  const client = new SonosClient(coordinatorIp);
  switch (command) {
    case "play":
      await client.play();
      break;
    case "pause":
      await client.pause();
      break;
    case "next":
      await client.next();
      break;
    case "previous":
      await client.previous();
      break;
  }
}

/**
 * Joins a member device into the group whose coordinator UUID is given.
 * Sets x-rincon:<coordinatorUuid> as the transport URI, then calls play()
 * to activate the join. THROWS on any failure.
 */
export async function sonosGroupJoin({
  memberIp,
  coordinatorUuid,
}: {
  memberIp: string;
  coordinatorUuid: string;
}): Promise<void> {
  const client = new SonosClient(memberIp);
  await client.setAVTransportURI(`x-rincon:${coordinatorUuid}`, "");
  await client.play();
}

/**
 * Removes a member from its current group, making it standalone again, via
 * BecomeCoordinatorOfStandaloneGroup , the canonical leave action. (Pointing
 * the transport at x-rincon-stream:<own-uuid>:0 faults with UPnP 714 on
 * devices without a line-in jack, e.g. the Beam.) THROWS on any failure.
 * memberUuid is unused but kept in the signature , the tRPC input shape is
 * shared with the web client.
 */
export async function sonosGroupLeave({
  memberIp,
}: {
  memberIp: string;
  memberUuid: string;
}): Promise<void> {
  const client = new SonosClient(memberIp);
  await client.becomeCoordinatorOfStandaloneGroup();
}

/**
 * Switches a device to its line-in source.
 * URI: x-rincon-stream:<sourceUuid>:0 , points the device at the hardware
 * line-in of the source device (often the same device for self-line-in).
 * Calls play() after to start playback. THROWS on any failure.
 */
export async function sonosSetLineIn({
  deviceIp,
  sourceUuid,
}: {
  deviceIp: string;
  sourceUuid: string;
}): Promise<void> {
  const client = new SonosClient(deviceIp);
  await client.setAVTransportURI(`x-rincon-stream:${sourceUuid}:0`, "");
  await client.play();
}

/**
 * Grabs TV audio from the Sonos Beam via SPDIF (HDMI ARC / optical).
 * URI: x-sonos-htastream:<beamUuid>:spdif , the Beam's TV audio stream.
 * Calls play() after to start playback. THROWS on any failure.
 */
export async function sonosGrabTvToBeam({
  beamIp,
  beamUuid,
}: {
  beamIp: string;
  beamUuid: string;
}): Promise<void> {
  const client = new SonosClient(beamIp);
  await client.setAVTransportURI(`x-sonos-htastream:${beamUuid}:spdif`, "");
  await client.play();
}
