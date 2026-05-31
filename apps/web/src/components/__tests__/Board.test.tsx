import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the entire tile registry so no tile component (or its transitive deps
// like maplibre-gl) are loaded in jsdom. Board only needs the registry shape.
vi.mock("../../lib/tile-registry", () => ({
  TILE_REGISTRY: [],
  deriveGridAreas: () => '""',
}));
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));

import { Board } from "../Board";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Board", () => {
  it("renders a #stage element", () => {
    render(<Board />);
    const stage = document.getElementById("stage");
    expect(stage).not.toBeNull();
  });

  it("renders a #scaler element inside #stage", () => {
    render(<Board />);
    const scaler = document.getElementById("scaler");
    expect(scaler).not.toBeNull();
  });
});
