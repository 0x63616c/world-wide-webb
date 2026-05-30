import { ha } from "../integrations/homeassistant";

export interface CameraInfo {
  label: string;
  online: boolean;
  snapshotUrl: string | null;
  /** Always null for now — stream URL is designed but not yet wired. */
  streamUrl: string | null;
  entityId: string | null;
}

/**
 * Resolves the best camera entity from Home Assistant.
 *
 * Priority:
 *  1. An entity whose id or friendly_name contains "living" or "dog".
 *  2. The first entity in the camera.* domain.
 *  3. null when HA is unconfigured, unreachable, or has no camera entities.
 */
export async function getCameraInfo(): Promise<CameraInfo | null> {
  if (!ha.isConfigured()) {
    return null;
  }

  let entities: Awaited<ReturnType<typeof ha.getEntities>>;
  try {
    entities = await ha.getEntities("camera");
  } catch {
    return null;
  }

  if (entities.length === 0) {
    return null;
  }

  const preferred = entities.find((e) => {
    const id = e.entity_id.toLowerCase();
    const name = String(e.attributes.friendly_name ?? "").toLowerCase();
    return (
      id.includes("living") || id.includes("dog") || name.includes("living") || name.includes("dog")
    );
  });

  const entity = preferred ?? entities[0];
  const friendlyName = entity.attributes.friendly_name as string | undefined;

  return {
    label: friendlyName ?? entity.entity_id,
    online: entity.state !== "unavailable",
    // HA camera proxy requires Bearer auth; the browser <img> tag can't send
    // auth headers. A proper authenticated proxy route is deferred (CC-2x4).
    snapshotUrl: null,
    streamUrl: null,
    entityId: entity.entity_id,
  };
}
