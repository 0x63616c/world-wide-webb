import { z } from "zod";

export const walkId = z.string().min(1).max(128);
const date = z.iso.datetime({ offset: true }).refine((v) => Number.isFinite(Date.parse(v)));
export const startInput = z
  .object({
    id: z.uuid().optional(),
    startedAt: date.optional(),
    source: z.enum(["iphone", "ipad", "web", "unknown"]).default("unknown"),
  })
  .prefault({});
export const historyInput = z
  .object({
    limit: z.number().int().min(1).max(500).default(50),
    before: date.optional(),
  })
  .prefault({});
export const stopInput = z.object({ id: walkId, endedAt: date.optional() });
export const updateInput = z.object({
  id: walkId,
  startedAt: date.optional(),
  endedAt: date.optional(),
});
export interface Walk {
  id: string;
  startedAt: string;
  endedAt: string | null;
  source: "iphone" | "ipad" | "web" | "unknown";
  createdAt: string;
  updatedAt: string;
}
export interface WalkState {
  active: Walk | null;
  updatedAt: string;
  serverTime: string;
}
