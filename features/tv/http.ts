import { defineHttp } from "@app-kit";
import { getTvArtwork } from "./service";

/**
 * Now-playing artwork proxy (Track C, Wave 6 fold , moved off the hardcoded
 * server.ts ladder onto the S3 route table). CORS is overlaid centrally by
 * server.ts's route-table iterator; do NOT set it here (mirror
 * features/wakes/http.ts).
 */
export const routes = defineHttp([
  {
    method: "GET",
    path: "/media/tv-artwork",
    match: "exact",
    handler: async () => {
      const artwork = await getTvArtwork();
      if (!artwork) return new Response("Not Found", { status: 404 });
      return new Response(artwork.body, {
        status: 200,
        headers: {
          "Content-Type": artwork.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "public, max-age=300",
        },
      });
    },
  },
]);
