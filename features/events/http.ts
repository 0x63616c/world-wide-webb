import { defineHttp } from "@app-kit";
import { getSettings } from "@app-kit/server";
import { matchesBearer } from "@www/platform/http-auth";
import { z } from "zod";
import { config } from "./config";
import { alarmInputSchema, occurrenceActionSchema } from "./contract";
import { AlarmError, alarmService } from "./service";

const MAX_BODY_BYTES = 8192;

async function jsonBody(req: Request): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new AlarmError(400, "Use application/json");
  const reader = req.body?.getReader();
  if (!reader) throw new AlarmError(400, "Missing JSON body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY_BYTES) throw new AlarmError(400, "Alarm request is too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AlarmError(400, "Invalid JSON");
  }
}

function authenticated(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!config.ALARM_API_TOKEN || config.ALARM_API_TOKEN.length < 32)
      return Response.json({ error: "Alarm automation is not configured" }, { status: 503 });
    if (!matchesBearer(req, config.ALARM_API_TOKEN))
      return Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      );
    try {
      const response = await handler(req);
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      if (error instanceof z.ZodError)
        return Response.json(
          {
            error: "Invalid alarm details",
            issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          },
          { status: 400 },
        );
      if (error instanceof AlarmError)
        return Response.json({ error: error.message }, { status: error.status });
      throw error;
    }
  };
}

export const routes = defineHttp([
  {
    method: "POST",
    path: "/api/alarms",
    match: "exact",
    handler: authenticated(async (req) => {
      const key = req.headers.get("Idempotency-Key") ?? undefined;
      if (key && !/^[a-zA-Z0-9_-]{8,128}$/.test(key))
        throw new AlarmError(400, "Invalid Idempotency-Key");
      const body = z.record(z.string(), z.unknown()).parse(await jsonBody(req));
      const input = alarmInputSchema.parse({
        ...body,
        timeZone: body.timeZone ?? (await getSettings()).timeZone,
      });
      return Response.json(await alarmService.create(input, key), { status: 201 });
    }),
  },
  {
    method: "GET",
    path: "/api/alarms",
    match: "exact",
    handler: authenticated(async () => Response.json(await alarmService.snapshot())),
  },
  {
    method: "POST",
    path: "/api/alarms/action",
    match: "exact",
    handler: authenticated(async (req) => {
      const input = occurrenceActionSchema
        .extend({ action: z.enum(["stop", "snooze"]) })
        .parse(await jsonBody(req));
      return Response.json(await alarmService.act(input.id, input.version, input.action));
    }),
  },
]);
