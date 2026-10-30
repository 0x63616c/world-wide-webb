import { HaError, haFromConfig } from "@www/core";
import { config } from "./config";
import { cameraIdSchema } from "./contract";

const ha = haFromConfig(config);

export async function listCameras() {
  try {
    if (!ha.isConfigured()) throw new HaError(503, "Cameras unavailable");
    const entities = await ha.getEntities("camera");
    return entities
      .filter((entity) => cameraIdSchema.safeParse(entity.entity_id).success)
      .map((entity) => ({
        id: entity.entity_id,
        name:
          typeof entity.attributes.friendly_name === "string"
            ? entity.attributes.friendly_name
            : entity.entity_id,
        state: entity.state,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // Never forward HA bodies/attributes, entity_picture URLs, or camera tokens.
    throw new HaError(503, "Cameras unavailable");
  }
}

export async function cameraSnapshot(id: string): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!cameraIdSchema.safeParse(id).success)
    return Response.json({ error: "Invalid camera" }, { status: 400, headers });
  try {
    if (!ha.isConfigured()) throw new HaError(503, "Cameras unavailable");
    // A validated entity ID is the only client-controlled part of the upstream path.
    const response = await ha.getMedia(`/api/camera_proxy/${id}`);
    const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (
      !response.body ||
      !contentType ||
      !["image/jpeg", "image/png", "image/webp"].includes(contentType)
    ) {
      await response.body?.cancel();
      return Response.json({ error: "Snapshot unavailable" }, { status: 502, headers });
    }
    // Stream the body; do not forward upstream cookies, redirects or cache headers.
    return new Response(response.body, { headers: { ...headers, "Content-Type": contentType } });
  } catch (error) {
    return Response.json(
      { error: "Snapshot unavailable" },
      { status: error instanceof HaError && error.status === 404 ? 404 : 503, headers },
    );
  }
}
