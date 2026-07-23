import { expect, it } from "vitest";
import { CodegenError, validate } from "./validate";

const baseTile = { label: "x", component: () => null, worldCol: 0, worldRow: 0, cols: 1, rows: 1 };
const base = {
  source: "feature" as const,
};
// Derives the single tile's id from the app id, so single-tile-per-app test
// cases keep distinct tile ids (only the dedicated dup-tile-id case sets a
// colliding id deliberately).
const app = (
  over: Partial<{
    id: string;
    tileId: string;
    home: boolean;
    guestExposed: boolean;
    worldCol: number;
    worldRow: number;
    cols: number;
    rows: number;
  }>,
) => ({
  ...base,
  id: over.id ?? "a",
  guestExposed: over.guestExposed ?? false,
  tiles: [
    {
      ...baseTile,
      id: over.tileId ?? over.id ?? "a",
      home: over.home ?? false,
      worldCol: over.worldCol ?? 0,
      worldRow: over.worldRow ?? 0,
      cols: over.cols ?? 1,
      rows: over.rows ?? 1,
    },
  ],
});

it("throws on duplicate id", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true }), app({ id: "a" })] }, [])).toThrow(
    CodegenError,
  );
});
it("throws when home count != 1", () => {
  expect(() => validate({ apps: [app({ id: "a" }), app({ id: "b" })] }, [])).toThrow(
    /exactly one home/,
  );
});
it("throws on overlapping tile rects", () => {
  expect(() =>
    validate(
      { apps: [app({ id: "a", home: true, worldCol: 0, cols: 2 }), app({ id: "b", worldCol: 1 })] },
      [],
    ),
  ).toThrow(/overlap/);
});
it("throws when guestExposed flag diverges from the GUEST_EXPOSED allowlist", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true, guestExposed: true })] }, [])).toThrow(
    /GUEST_EXPOSED/,
  );
  expect(() =>
    validate({ apps: [app({ id: "a", home: true, guestExposed: false })] }, ["a"]),
  ).toThrow(/GUEST_EXPOSED/);
});
it("accepts a consistent model", () => {
  expect(() =>
    validate({ apps: [app({ id: "a", home: true, guestExposed: true })] }, ["a"]),
  ).not.toThrow();
});

it("throws on a duplicate table name across the feature + base schemas", () => {
  expect(() =>
    validate(
      {
        apps: [app({ id: "a", home: true })],
        tables: [
          { name: "portal_authorization", source: "feature:guest-wifi" },
          { name: "portal_authorization", source: "base" },
        ],
      },
      [],
    ),
  ).toThrow(/duplicate table name/);
});

it("throws when two features expose the same top-level router key", () => {
  expect(() =>
    validate(
      {
        apps: [app({ id: "a", home: true })],
        routerKeys: [
          { key: "portal", source: "feature:guest-wifi" },
          { key: "portal", source: "feature:other" },
        ],
      },
      [],
    ),
  ).toThrow(/duplicate router key/);
});

it("accepts distinct table names + router keys", () => {
  expect(() =>
    validate(
      {
        apps: [app({ id: "a", home: true, guestExposed: true })],
        tables: [
          { name: "portal_authorization", source: "feature:guest-wifi" },
          { name: "job", source: "base" },
        ],
        routerKeys: [{ key: "portal", source: "feature:guest-wifi" }],
      },
      ["a"],
    ),
  ).not.toThrow();
});

// ─── multi-tile proof (F0) ────────────────────────────────────────────────

it("accepts a single app with two non-overlapping tiles, exactly one home", () => {
  const twoTile = {
    ...base,
    id: "multi",
    guestExposed: false,
    tiles: [
      { ...baseTile, id: "multi_a", home: true, worldCol: 0, worldRow: 0, cols: 1, rows: 1 },
      { ...baseTile, id: "multi_b", home: false, worldCol: 2, worldRow: 0, cols: 1, rows: 1 },
    ],
  };
  expect(() => validate({ apps: [twoTile] }, [])).not.toThrow();
});

it("throws when a two-tile app has a second home tile", () => {
  const twoHome = {
    ...base,
    id: "multi",
    guestExposed: false,
    tiles: [
      { ...baseTile, id: "multi_a", home: true, worldCol: 0, worldRow: 0, cols: 1, rows: 1 },
      { ...baseTile, id: "multi_b", home: true, worldCol: 2, worldRow: 0, cols: 1, rows: 1 },
    ],
  };
  expect(() => validate({ apps: [twoHome] }, [])).toThrow(/exactly one home/);
});

it("throws when two tiles of the same app overlap (intra-app overlap)", () => {
  const overlapping = {
    ...base,
    id: "multi",
    guestExposed: false,
    tiles: [
      { ...baseTile, id: "multi_a", home: true, worldCol: 0, worldRow: 0, cols: 2, rows: 1 },
      { ...baseTile, id: "multi_b", home: false, worldCol: 1, worldRow: 0, cols: 2, rows: 1 },
    ],
  };
  expect(() => validate({ apps: [overlapping] }, [])).toThrow(/overlap/);
});

it("throws when two tiles (any apps) share a tile id", () => {
  expect(() =>
    validate(
      {
        apps: [
          app({ id: "a", tileId: "dup", home: true }),
          app({ id: "b", tileId: "dup", worldCol: 5 }),
        ],
      },
      [],
    ),
  ).toThrow(/duplicate tile id/);
});
