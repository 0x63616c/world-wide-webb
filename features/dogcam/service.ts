import { createHomeAssistantClient, type HaEntity } from "@www/core";
import { getLogger } from "@www/logger";
import { config } from "./config";

// Module-level singleton built from this feature's own config slice (mirrors
// features/network's createUnifiClient precedent) — never apps/api's `ha`.
const ha = createHomeAssistantClient({ baseUrl: config.HA_URL, token: config.HA_TOKEN });

export interface CameraInfo {
  label: string;
  online: boolean;
  snapshotUrl: string | null;
  /** Path to the api's MJPEG proxy route, served from the same origin as the panel. */
  streamUrl: string | null;
  entityId: string | null;
}

/** The api route that proxies go2rtc's MJPEG stream (see apps/api/src/server.ts). */
const STREAM_ROUTE = "/media/camera-stream";

/**
 * Describes the camera tile's stream.
 *
 * The camera is driven by go2rtc, which pulls RTSP straight off the camera on
 * the LAN. That deliberately does NOT depend on Home Assistant: HA has proven
 * flaky and blanking the tile every time it falls over is unacceptable. So the
 * populated CameraInfo below is produced unconditionally from go2rtc config.
 *
 * Home Assistant is OPTIONAL ENRICHMENT only, if it happens to answer with a
 * camera entity we borrow its friendly_name and entity_id. If HA is
 * unconfigured, unreachable, or throws, we swallow it and return the go2rtc
 * view. HA can never blank the tile and can never mark it offline.
 */
export async function getCameraInfo(): Promise<CameraInfo | null> {
  const info: CameraInfo = {
    label: config.CAMERA_LABEL,
    online: true,
    // The camera exposes no still endpoint we proxy today; the live MJPEG
    // stream is the tile's only surface.
    snapshotUrl: null,
    streamUrl: STREAM_ROUTE,
    entityId: null,
  };

  const entity = await findHaCameraEntity();
  if (!entity) return info;

  const friendlyName = entity.attributes.friendly_name as string | undefined;
  return {
    ...info,
    label: friendlyName ?? info.label,
    entityId: entity.entity_id,
  };
}

/**
 * Best-effort lookup of a camera entity in HA. Never throws, any HA failure
 * resolves to null and the caller falls back to the go2rtc-only view.
 */
async function findHaCameraEntity(): Promise<HaEntity | null> {
  if (!ha.isConfigured()) return null;

  try {
    const entities = await ha.getEntities("camera");
    if (entities.length === 0) return null;

    const preferred = entities.find((e) => {
      const id = e.entity_id.toLowerCase();
      const name = String(e.attributes.friendly_name ?? "").toLowerCase();
      return (
        id.includes("bedroom") ||
        id.includes("living") ||
        id.includes("dog") ||
        name.includes("bedroom") ||
        name.includes("living") ||
        name.includes("dog")
      );
    });

    return preferred ?? entities[0];
  } catch {
    // HA down/misconfigured, the tile does not need it. Stay silent at info
    // level; the go2rtc stream is the source of truth.
    return null;
  }
}

/**
 * Opens the live MJPEG stream from go2rtc and hands the upstream Response back
 * so apps/api/src/server.ts's raw /media/camera-stream route can pipe its body
 * straight through to the panel.
 *
 * NO AbortSignal / timeout is attached anywhere on this path: an MJPEG
 * multipart response is a long-lived connection that never "completes", so any
 * timeout would kill the live feed mid-flight.
 *
 * Returns null on a non-ok upstream or a transport error. Never logs the RTSP
 * URL or camera credentials, those live only inside go2rtc's own config.
 */
export async function openCameraStream(): Promise<Response | null> {
  const url = `${config.GO2RTC_URL}/api/stream.mjpeg?src=${encodeURIComponent(config.CAMERA_STREAM_NAME)}`;
  const startedAt = performance.now();

  try {
    const res = await fetch(url);
    const durationMs = +(performance.now() - startedAt).toFixed(1);

    if (!res.ok) {
      getLogger().warn({ status: res.status, durationMs }, "go2rtc stream request failed");
      return null;
    }
    return res;
  } catch (err) {
    const durationMs = +(performance.now() - startedAt).toFixed(1);
    getLogger().warn({ err, durationMs }, "go2rtc unreachable");
    return null;
  }
}
