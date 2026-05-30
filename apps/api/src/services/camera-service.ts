import { ha } from "../integrations/homeassistant";

export interface CameraInfo {
  label: string;
  online: boolean;
  snapshotUrl: string | null;
  /** Always null for now — stream URL is designed but not yet wired. */
  streamUrl: string | null;
  entityId: string | null;
}

const FALLBACK: CameraInfo = {
  label: "Living Room",
  online: false,
  snapshotUrl: null,
  streamUrl: null,
  entityId: null,
};

/**
 * Resolves the best camera entity from Home Assistant.
 *
 * Priority:
 *  1. An entity whose id or friendly_name contains "living" or "dog".
 *  2. The first entity in the camera.* domain.
 *  3. Fallback placeholder when HA is unconfigured or unreachable.
 */
export async function getCameraInfo(): Promise<CameraInfo> {
  if (!ha.isConfigured()) {
    return FALLBACK;
  }

  let entities: Awaited<ReturnType<typeof ha.getEntities>>;
  try {
    entities = await ha.getEntities("camera");
  } catch {
    return FALLBACK;
  }

  if (entities.length === 0) {
    return FALLBACK;
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
    label: friendlyName ?? "Living Room",
    online: entity.state !== "unavailable",
    snapshotUrl: ha.cameraProxyUrl(entity.entity_id),
    streamUrl: null,
    entityId: entity.entity_id,
  };
}
