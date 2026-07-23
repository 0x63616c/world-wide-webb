import { expect, it } from "vitest";
import { collect } from "./collect";
import { validate } from "./validate";

// Lightweight sanity check that collect() over the REAL tile registry produces
// a model validate() accepts (exactly one home tile, no guestExposed
// divergence against an empty allowlist — nothing is guest-exposed yet). The
// dedicated collect.test.ts suite covering features/*/manifest.ts arrives in
// Slice 5; this is just the registry-only guard for this slice.
it("collect() over the real tile registry passes validate() with an empty guest allowlist", async () => {
  const model = await collect();
  expect(() => validate(model, [])).not.toThrow();
});
