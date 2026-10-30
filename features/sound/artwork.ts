import { type HomeAssistantClient, haFromConfig } from "@www/core";
import { z } from "zod";
import { config } from "./config";

const ha = haFromConfig(config);
const roomId = z
  .string()
  .max(255)
  .regex(/^media_player\.[a-z0-9_]+$/);

/** Only an entity ID crosses the boundary; artwork URLs and HA tokens stay server-side. */
export async function sonosArtwork(
  id: string,
  client: Pick<HomeAssistantClient, "isConfigured" | "getMedia"> = ha,
): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!roomId.safeParse(id).success)
    return Response.json({ error: "Invalid room" }, { status: 400, headers });
  try {
    if (!client.isConfigured()) throw new Error("Unavailable");
    const response = await client.getMedia(`/api/media_player_proxy/${id}`);
    const type = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (
      !response.ok ||
      !response.body ||
      !type ||
      !["image/jpeg", "image/png", "image/webp"].includes(type)
    ) {
      await response.body?.cancel();
      return Response.json({ error: "Artwork unavailable" }, { status: 502, headers });
    }
    return new Response(response.body, { headers: { ...headers, "Content-Type": type } });
  } catch {
    return Response.json({ error: "Artwork unavailable" }, { status: 503, headers });
  }
}
