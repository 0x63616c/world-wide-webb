import { defineHttp } from "@app-kit";
import { sonosArtwork } from "./artwork";

export const routes = defineHttp([
  {
    method: "GET",
    path: "/media/sonos/",
    match: "prefix",
    handler: async (_req, url) => {
      const match = /^\/media\/sonos\/([^/]+)\/artwork$/.exec(url.pathname);
      if (!match || url.search)
        return Response.json(
          { error: "Not found" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      return sonosArtwork(match[1]);
    },
  },
]);
