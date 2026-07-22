import { z } from "zod";

// Edge schema for an HA `/api/states` entity. The client parses responses with
// this so domain code consumes validated entities (www-355t.16). `attributes` is
// an open bag (fan_modes, brightness, friendly_name, …) kept fully as unknown;
// the entity object stays loose so HA's extra top-level fields (context,
// last_reported, …) pass through untouched.
export const haEntitySchema = z.looseObject({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  last_updated: z.string(),
  last_changed: z.string().optional(),
});

export type HaEntity = z.infer<typeof haEntitySchema>;

export class HaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HaError";
  }
}
