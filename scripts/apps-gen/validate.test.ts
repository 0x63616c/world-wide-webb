import { expect, it } from "vitest";
import { CodegenError, validate } from "./validate";

const base = {
  tile: { label: "x", component: () => null, worldCol: 0, worldRow: 0, cols: 1, rows: 1 },
  source: "feature" as const,
};
const app = (
  over: Partial<{
    id: string;
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
  home: over.home ?? false,
  guestExposed: over.guestExposed ?? false,
  tile: {
    ...base.tile,
    worldCol: over.worldCol ?? 0,
    worldRow: over.worldRow ?? 0,
    cols: over.cols ?? 1,
    rows: over.rows ?? 1,
  },
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
