import { defineHttp } from "@app-kit";
import { matchesBearer } from "@www/platform/http-auth";
import { z } from "zod";
import { config } from "./config";
import { appIdSchema, releaseInputSchema } from "./contract";
import { releaseService } from "./service";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
async function validated(handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "Invalid release details" }, 400);
    throw error;
  }
}
async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError();
  let body = "";
  const decoder = new TextDecoder();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) throw new SyntaxError();
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    await reader.cancel();
  }
}
export const routes = defineHttp([
  {
    method: "GET",
    path: "/api/releases/latest",
    match: "exact",
    handler: (req) =>
      validated(async () => {
        const app = appIdSchema.parse(new URL(req.url).searchParams.get("app"));
        const release = await releaseService.latest(app);
        return release ? json(release) : json({ error: "No release recorded" }, 404);
      }),
  },
  {
    method: "POST",
    path: "/api/releases/latest",
    match: "exact",
    handler: async (req) => {
      if (!config.ALARM_API_TOKEN || config.ALARM_API_TOKEN.length < 32)
        return json({ error: "Release automation is not configured" }, 503);
      if (!matchesBearer(req, config.ALARM_API_TOKEN))
        return Response.json(
          { error: "Unauthorized" },
          {
            status: 401,
            headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" },
          },
        );
      return validated(async () => {
        if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
          return json({ error: "Use application/json" }, 400);
        return json(await releaseService.record(releaseInputSchema.parse(await readBody(req))));
      });
    },
  },
]);
