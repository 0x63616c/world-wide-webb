import { defineHttp } from "@app-kit";
import { cameraSnapshot } from "./service";

export const routes = defineHttp([
  {
    method: "GET",
    path: "/media/cameras/",
    match: "prefix",
    handler: async (_req, url) => {
      const match = /^\/media\/cameras\/([^/]+)\/snapshot$/.exec(url.pathname);
      if (!match || url.search)
        return Response.json(
          { error: "Not found" },
          { status: 404, headers: { "Cache-Control": "no-store" } },
        );
      return cameraSnapshot(match[1]);
    },
  },
]);
