import { describe, expect, it } from "vitest";
import { TileStatus } from "@/components/ui/tile-status";
import { useTileQuery } from "../useTileQuery";

// useTileQuery is a pure mapper (no React state/effects), so it is exercised as
// a plain function , the whole contract is the status precedence.
describe("useTileQuery status mapping", () => {
  it("is loading before any data arrives (no error)", () => {
    const result = useTileQuery<{ n: number } | undefined>({ data: undefined, isError: false });
    expect(result.status).toBe(TileStatus.Loading);
    expect(result.data).toBeUndefined();
  });

  it("is error when the query failed with nothing to show", () => {
    const result = useTileQuery<{ n: number } | undefined>({ data: undefined, isError: true });
    expect(result.status).toBe(TileStatus.Error);
    expect(result.data).toBeUndefined();
  });

  it("is populated once data is present", () => {
    const data = { n: 1 };
    const result = useTileQuery({ data, isError: false });
    expect(result.status).toBe(TileStatus.Populated);
    expect(result.data).toBe(data);
  });

  it("stays populated on stale data when a later poll errors (never flashes error)", () => {
    const data = { n: 1 };
    const result = useTileQuery({ data, isError: true });
    expect(result.status).toBe(TileStatus.Populated);
    expect(result.data).toBe(data);
  });

  it("treats null data as no-data-yet, not populated", () => {
    const result = useTileQuery<{ n: number } | null>({ data: null, isError: false });
    expect(result.status).toBe(TileStatus.Loading);
    expect(result.data).toBeUndefined();
  });

  it("treats an empty array as populated (there is something to render)", () => {
    const result = useTileQuery<number[]>({ data: [], isError: false });
    expect(result.status).toBe(TileStatus.Populated);
    expect(result.data).toEqual([]);
  });
});
