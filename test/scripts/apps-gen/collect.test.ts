import { beforeAll, expect, it } from "vitest";
import { defineTileViews, defineWorkerCycles } from "../../../app-kit";
import {
  collect,
  collectTileViewsExport,
  collectWorkerCyclesExport,
} from "../../../scripts/apps-gen/collect";
import { validate } from "../../../scripts/apps-gen/validate";

let collected: Awaited<ReturnType<typeof collect>>;

beforeAll(async () => {
  collected = await collect();
}, 20_000);

it("requires the conventional tileViews export consumed by web.gen.ts", () => {
  const tileViews = defineTileViews([{ tileId: "tile_weather" }]);

  expect(collectTileViewsExport({ tileViews }, "weather")).toBe(tileViews);
  expect(() => collectTileViewsExport({ views: tileViews }, "weather")).toThrow(
    /exactly one.*named tileViews/,
  );
  expect(() => collectTileViewsExport({ tileViews, views: tileViews }, "weather")).toThrow(
    /exactly one.*named tileViews/,
  );
});

it("requires the conventional cycles export consumed by workers.gen.ts", () => {
  const cycles = defineWorkerCycles([
    { name: "weather-ingest", intervalMs: 1000, run: async () => {} },
  ]);

  expect(collectWorkerCyclesExport({ cycles }, "weather")).toBe(cycles);
  expect(() => collectWorkerCyclesExport({ workers: cycles }, "weather")).toThrow(
    /exactly one.*named cycles/,
  );
  expect(() => collectWorkerCyclesExport({ cycles, workers: cycles }, "weather")).toThrow(
    /exactly one.*named cycles/,
  );
});

// Sanity check that collection over the real App facets produces one complete,
// valid model.
it("collect() includes the booth App manifest exactly once, with its facets", () => {
  const model = collected;

  const booth = model.apps.filter((a) => a.id === "tile_booth");
  expect(booth).toHaveLength(1);
  expect(booth[0].source).toBe("feature");
  expect(booth[0].private).toBe(true);

  // The fold surfaces: the feature's table, its router key, its schema exports.
  expect(model.features.map((f) => f.dir)).toContain("booth");
  expect(model.tables.map((t) => t.name)).toEqual(expect.arrayContaining(["booth_photo"]));
  expect(model.routerKeys).toContainEqual({ key: "boothPhotos", source: "feature:booth" });
  expect(model.schemaExports).toContainEqual({ name: "boothPhoto", source: "feature:booth" });

  // And the whole collected model still validates.
  expect(() => validate(model)).not.toThrow();
});

// The base apps/api/src/db/schema.ts module re-exports several symbols from
// @www/core (`export { ... } from "@www/core"`, not a local declaration).
// Object.keys() on the imported module module picks these up the same way as
// locally-declared exports, so they must appear with source "base".
it("collect() sources the base schema's @www/core re-exports with source 'base'", () => {
  const model = collected;
  const baseExportNames = model.schemaExports.filter((e) => e.source === "base").map((e) => e.name);
  expect(baseExportNames).toEqual(
    expect.arrayContaining(["deviceState", "integrationSyncStatus", "DeviceKind"]),
  );
});

// Track C, final tile fold: the booth-photo upload facet moved out of the
// interim http list into features/booth/http.ts, collected via Source A (the
// same path api.ts/jobs.ts use), not the interim list — the last entry to
// leave INTERIM_HTTP_MODULES, which is now permanently empty.
it("sources the booth-photo route from the booth feature, not the interim list", () => {
  const model = collected;

  expect(model.httpRoutes).toContainEqual({
    method: "POST",
    path: "/media/booth-photo",
    match: "exact",
    source: "feature:booth",
  });
  expect(model.httpModules.map((m) => m.ident)).toContain("boothHttp");
});

// Track C, Wave 5 fold: the wake-photo upload facet moved out of the interim
// http list into features/wakes/http.ts, collected via Source A (the same path
// api.ts/jobs.ts use), not the interim list.
it("collect() sources the wake-photo route from the wakes feature, not the interim list", () => {
  const model = collected;

  expect(model.httpRoutes).toContainEqual({
    method: "POST",
    path: "/media/wake-photo",
    match: "exact",
    source: "feature:wakes",
  });
  expect(model.httpModules.map((m) => m.ident)).toContain("wakesHttp");
});

// The first multi-tile fold: features/weather declares TWO tiles
// (tile_weath + tile_hourly) under one app id (tile_weather). This is the
// regression guard for the collect.ts dedup fix — a multi-tile app's tile ids
// differ from its app id, so the registry-leftover filter must dedup on the
// union of feature TILE ids, not app ids, or both tiles double-collect.
it("collect() sources both weather tiles once from the two-tile feature manifest", () => {
  const model = collected;
  const weather = model.apps.filter((a) => a.id === "tile_weather");
  expect(weather).toHaveLength(1);
  expect(weather[0].source).toBe("feature");
  expect(weather[0].tiles.map((t) => t.id).sort()).toEqual(["tile_hourly", "tile_weath"]);
  // The BLOCKER regression guard: neither tile id leaks back in as a registry app.
  expect(model.apps.filter((a) => a.id === "tile_weath")).toHaveLength(0);
  expect(model.apps.filter((a) => a.id === "tile_hourly")).toHaveLength(0);
  expect(() => validate(model)).not.toThrow();
});

// features/events declares ONE tile now: the Clock face. Upcoming went with
// the events table, and the Clock is FACE-ONLY — it declares no Tile View at
// all, which is the zero-or-one invariant this collect must allow.
it("collect() sources the clock tile from the events feature, with no Tile View", () => {
  const model = collected;
  const events = model.apps.filter((a) => a.id === "tile_events");
  expect(events).toHaveLength(1);
  expect(events[0].source).toBe("feature");
  expect(events[0].tiles.map((t) => t.id)).toEqual(["tile_clock"]);
  expect(model.features.find((f) => f.dir === "events")?.hasDetail).toBe(false);
  expect(model.tileViews.map((v) => v.tileId)).not.toContain("tile_clock");
  expect(() => validate(model)).not.toThrow();
});

// A Tile has ZERO OR ONE Tile Views. The four face-only tiles declare none;
// every declaration that IS present must belong to a real Tile.
it("collect() finds at most one App-owned Tile View per board Tile", () => {
  const model = collected;
  const tileIds = new Set(model.apps.flatMap((app) => app.tiles.map((tile) => tile.id)));
  const declared = model.tileViews.map((view) => view.tileId);

  expect(new Set(declared).size).toBe(declared.length);
  for (const tileId of declared) expect(tileIds.has(tileId)).toBe(true);
  expect(declared.sort()).toEqual(["tile_booth", "tile_ctrl", "tile_sound", "tile_wakes"]);
});

it("collect() sources worker cycles from owning App facets", () => {
  const model = collected;

  expect(model.workerCycles).toContainEqual({
    name: "weather-ingest",
    source: "feature:weather",
  });
  // Sound delegates writes to HA and deliberately has no second polling writer.
  expect(model.workerCycles).not.toContainEqual({
    name: "sonos-volume-enforcer",
    source: "feature:sound",
  });
  expect(model.features.find((feature) => feature.dir === "weather")?.hasWorker).toBe(true);
  expect(model.workerCycles.map((cycle) => cycle.name).sort()).toEqual([
    "climate-enforcer",
    "device-sync",
    "light-enforcer",
    "party-mode",
    "weather-ingest",
    "weather-purge",
  ]);
});
