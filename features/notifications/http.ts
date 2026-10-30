import { defineHttp } from "@app-kit";
import { z } from "zod";
import {
  cursorSchema,
  notificationIdSchema,
  notificationInputSchema,
  notificationListSchema,
} from "./contract";
import { notificationService } from "./service";
import { notificationStream } from "./stream";

async function jsonBody(req: Request) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new Error("Use application/json");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing JSON body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32768) throw new Error("Request exceeds 32768 bytes");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel();
  }
}
const checked =
  (handler: (req: Request, url: URL) => Promise<Response>) => async (req: Request, url: URL) => {
    try {
      const response = await handler(req, url);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof z.ZodError)
        return Response.json(
          {
            error: "Invalid notification request",
            issues: error.issues.map(({ path, message }) => ({ path, message })),
          },
          { status: 400 },
        );
      throw error;
    }
  };
async function body(req: Request) {
  try {
    return await jsonBody(req);
  } catch {
    return null;
  }
}
// Same perimeter auth as existing panel tRPC/media endpoints (ADR-0004).
export const routes = defineHttp([
  {
    method: "POST",
    path: "/api/notifications",
    match: "exact",
    handler: checked(async (req) =>
      Response.json(
        await notificationService.create(notificationInputSchema.parse(await body(req))),
        { status: 201 },
      ),
    ),
  },
  {
    method: "GET",
    path: "/api/notifications",
    match: "exact",
    handler: checked(async (_req, url) =>
      Response.json(
        await notificationService.list(
          notificationListSchema.parse(Object.fromEntries(url.searchParams)),
        ),
      ),
    ),
  },
  {
    method: "POST",
    path: "/api/notifications/read",
    match: "exact",
    handler: checked(async (req) => {
      const { id } = notificationIdSchema.parse(await body(req));
      const row = await notificationService.act(id, "read");
      return Response.json(row ?? { error: "Notification not found" }, { status: row ? 200 : 404 });
    }),
  },
  {
    method: "POST",
    path: "/api/notifications/dismiss",
    match: "exact",
    handler: checked(async (req) => {
      const { id } = notificationIdSchema.parse(await body(req));
      const row = await notificationService.act(id, "dismiss");
      return Response.json(row ?? { error: "Notification not found" }, { status: row ? 200 : 404 });
    }),
  },
  {
    method: "POST",
    path: "/api/notifications/dismiss-all",
    match: "exact",
    handler: checked(async () => Response.json(await notificationService.dismissAll())),
  },
  {
    method: "GET",
    path: "/api/notifications/stream",
    match: "exact",
    handler: checked(async (req, url) => {
      const since = cursorSchema
        .optional()
        .parse(req.headers.get("Last-Event-ID") ?? url.searchParams.get("since") ?? undefined);
      return notificationStream(req, since);
    }),
  },
]);
