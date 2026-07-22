import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { closeTileDetail, openTileDetail, useTileDetail } from "../tile-detail-store";

// Module-level store: every test closes the detail it opened so state never
// leaks between tests.
afterEach(() => {
  act(() => closeTileDetail());
});

describe("tile-detail-store", () => {
  it("starts with no open detail", () => {
    const { result } = renderHook(() => useTileDetail());
    expect(result.current).toBeNull();
  });

  it("openTileDetail sets the target and subscribers see it live", () => {
    const { result } = renderHook(() => useTileDetail());
    act(() => openTileDetail("tile_tesla"));
    expect(result.current).toEqual({ tileId: "tile_tesla", variantSlug: undefined });
  });

  it("carries an optional variant slug for deep-linking a specific variant", () => {
    const { result } = renderHook(() => useTileDetail());
    act(() => openTileDetail("tile_tv", "remote"));
    expect(result.current).toEqual({ tileId: "tile_tv", variantSlug: "remote" });
  });

  it("closeTileDetail nulls the target", () => {
    const { result } = renderHook(() => useTileDetail());
    act(() => openTileDetail("tile_clock"));
    expect(result.current).not.toBeNull();
    act(() => closeTileDetail());
    expect(result.current).toBeNull();
  });

  it("re-opening a different tile replaces the target", () => {
    const { result } = renderHook(() => useTileDetail());
    act(() => openTileDetail("tile_clock"));
    act(() => openTileDetail("tile_weath", "week-outlook"));
    expect(result.current).toEqual({ tileId: "tile_weath", variantSlug: "week-outlook" });
  });

  it("closing when nothing is open is a no-op", () => {
    const { result } = renderHook(() => useTileDetail());
    expect(() => act(() => closeTileDetail())).not.toThrow();
    expect(result.current).toBeNull();
  });
});
