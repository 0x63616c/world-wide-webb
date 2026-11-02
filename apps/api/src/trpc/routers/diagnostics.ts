import { HomeAssistantClient } from "@www/core";
import { ENV } from "@www/platform/env";
import { z } from "zod";
import { publicProcedure, router } from "../init";

const payloadKeys = new Set([
  "value",
  "pct",
  "seconds",
  "positionSeconds",
  "key",
  "on",
  "enabled",
  "brightness",
  "kelvin",
  "temperature",
  "target",
  "low",
  "high",
  "volume",
  "position",
  "mode",
  "speed",
  "color",
  "id",
  "roomId",
  "entityId",
]);
const command = z.strictObject({
  control: z
    .string()
    .max(80)
    .regex(/^[a-zA-Z0-9._]+$/),
  payload: z
    .record(
      z.string(),
      z
        .string()
        .max(32)
        .regex(/^(<redacted>|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/),
    )
    .refine((value) => Object.keys(value).every((key) => payloadKeys.has(key))),
  status: z.number().int().min(100).max(599).nullish(),
  error: z
    .enum([
      "dropped: module not live",
      "dropped: action unavailable",
      "cancelled",
      "request failed",
    ])
    .nullish(),
  latencyMs: z.number().int().min(0).max(300_000),
});
const diagnosticsSubmission = z.strictObject({
  snapshot: z.strictObject({
    source: z.enum(["live", "fixture"]),
    backendURL: z
      .string()
      .max(256)
      .refine((value) => {
        if (value === "unconfigured") return true;
        try {
          const url = new URL(value);
          return ["https:", "http:"].includes(url.protocol) && url.origin === value;
        } catch {
          return false;
        }
      }),
    build: z
      .string()
      .max(32)
      .regex(/^[\d.]+$|^dev$/),
    gitSHA: z.string().regex(/^[a-f0-9]{7,40}$|^dev$/),
    backend: z.enum(["checking", "reachable", "unreachable"]),
    latencyMs: z.number().int().min(0).max(300_000).nullish(),
    homeAssistant: z.enum(["unknown", "connected", "unavailable", "unconfigured"]),
  }),
  commands: z.array(command).max(50),
});

// Kiosk calls use the same Cloudflare Access boundary as other publicProcedures.
// Deliberately volatile: bounded support evidence, lost on process restart.
export function createDiagnosticsStore() {
  const submissions: {
    timestamp: string;
    snapshot: z.infer<typeof diagnosticsSubmission>["snapshot"];
    commands: z.infer<typeof command>[];
  }[] = [];
  return {
    submit(input: unknown) {
      const parsed = diagnosticsSubmission.parse(input);
      if (JSON.stringify(parsed).length > 32_768)
        throw new Error("Diagnostics submission too large");
      submissions.push({ timestamp: new Date().toISOString(), ...parsed });
      if (submissions.length > 20) submissions.splice(0, submissions.length - 20);
      return { accepted: true };
    },
    list: () => structuredClone(submissions),
  };
}
const store = createDiagnosticsStore();
const ha = new HomeAssistantClient({ baseUrl: ENV.HA_URL, token: ENV.HA_TOKEN });
// /health/climate reads cached DB climate state, so it cannot establish a live HA connection.
export async function homeAssistantStatus(client = ha) {
  if (!client.isConfigured()) return "unconfigured" as const;
  try {
    await client.getEntities("climate");
    return "connected" as const;
  } catch {
    return "unavailable" as const;
  }
}
export const diagnosticsRouter = router({
  status: publicProcedure.query(async () => ({ homeAssistant: await homeAssistantStatus() })),
  submit: publicProcedure.input(diagnosticsSubmission).mutation(({ input }) => store.submit(input)),
  submissions: publicProcedure.query(() => store.list()),
});
