import { expect, it } from "vitest";
import { collect } from "./collect";
import { validate } from "./validate";

// Lightweight sanity check that collect() over the REAL tile registry produces
// a model validate() accepts (exactly one home tile, no guestExposed
// divergence against an empty allowlist — nothing is guest-exposed yet). The
// dedicated collect.test.ts suite covering features/*/manifest.ts arrives in
// Slice 5; this is just the registry-only guard for this slice.
it("collect() unions the guest-wifi feature manifest, deduped against the registry", async () => {
  const model = await collect();

  // The guest-wifi tile is sourced from features/guest-wifi/manifest.ts (source
  // "feature"), and appears EXACTLY once — the tile-registry entry that renders
  // it is deduped by id, so the feature is its only source in the model.
  const guest = model.apps.filter((a) => a.id === "tile_guestwifi");
  expect(guest).toHaveLength(1);
  expect(guest[0].source).toBe("feature");
  expect(guest[0].guestExposed).toBe(true);

  // A hand-placed tile still collects from the registry.
  expect(model.apps.find((a) => a.id === "tile_clock")?.source).toBe("registry");

  // The fold surfaces: the feature's tables, its router key, and its cron.
  expect(model.features.map((f) => f.dir)).toContain("guest-wifi");
  expect(model.tables.map((t) => t.name)).toEqual(
    expect.arrayContaining(["portal_authorization", "portal_rate_limit"]),
  );
  expect(model.routerKeys).toContainEqual({ key: "portal", source: "feature:guest-wifi" });
  expect(model.crons.map((c) => c.name)).toContain("guest-wifi-purge");

  // And the whole collected model still validates against the real allowlist.
  expect(() => validate(model, ["tile_guestwifi"])).not.toThrow();
});
