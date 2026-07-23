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

  // A hand-placed tile still collects from the registry (tile_clock folded
  // into features/events; tile_ctrl remains hand-placed).
  expect(model.apps.find((a) => a.id === "tile_ctrl")?.source).toBe("registry");

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

// S3 codegen-level proof: the interim apps/api booth/wake http facets collect
// through Source B (INTERIM_HTTP_MODULES), not featureDirs(), so this asserts
// the collector's SECOND collection source actually yields the two migrated
// routes , the real dispatch proof lives in
// apps/api/src/http/__tests__/route-table.test.ts.
it("collect() yields the migrated wake + booth routes from the interim http list", async () => {
  const model = await collect();

  expect(model.httpRoutes).toContainEqual({
    method: "POST",
    path: "/media/wake-photo",
    match: "exact",
    source: "interim:wake",
  });
  expect(model.httpRoutes).toContainEqual({
    method: "POST",
    path: "/media/booth-photo",
    match: "exact",
    source: "interim:booth",
  });
  expect(model.httpModules.map((m) => m.ident)).toEqual(
    expect.arrayContaining(["wakeHttp", "boothHttp"]),
  );
});

// The first multi-tile fold: features/weather declares TWO tiles
// (tile_weath + tile_hourly) under one app id (tile_weather). This is the
// regression guard for the collect.ts dedup fix — a multi-tile app's tile ids
// differ from its app id, so the registry-leftover filter must dedup on the
// union of feature TILE ids, not app ids, or both tiles double-collect.
it("collect() sources both weather tiles once from the two-tile feature manifest", async () => {
  const model = await collect();
  const weather = model.apps.filter((a) => a.id === "tile_weather");
  expect(weather).toHaveLength(1);
  expect(weather[0].source).toBe("feature");
  expect(weather[0].tiles.map((t) => t.id).sort()).toEqual(["tile_hourly", "tile_weath"]);
  // The BLOCKER regression guard: neither tile id leaks back in as a registry app.
  expect(model.apps.filter((a) => a.id === "tile_weath")).toHaveLength(0);
  expect(model.apps.filter((a) => a.id === "tile_hourly")).toHaveLength(0);
  expect(() => validate(model, ["tile_guestwifi"])).not.toThrow();
});

// Second multi-tile fold: features/events declares TWO tiles (tile_event +
// tile_clock) under one app id (tile_events). Same collect.ts dedup guard as
// weather above, plus this is the first fold that moves the board HOME tile —
// tile_clock's home:true must survive the collect into a single global home.
it("collect() sources both events tiles once from the two-tile feature manifest", async () => {
  const model = await collect();
  const events = model.apps.filter((a) => a.id === "tile_events");
  expect(events).toHaveLength(1);
  expect(events[0].source).toBe("feature");
  expect(events[0].tiles.map((t) => t.id).sort()).toEqual(["tile_clock", "tile_event"]);
  // Neither tile id leaks back in as a registry app.
  expect(model.apps.filter((a) => a.id === "tile_clock")).toHaveLength(0);
  expect(model.apps.filter((a) => a.id === "tile_event")).toHaveLength(0);
  expect(() => validate(model, ["tile_guestwifi"])).not.toThrow();
});
