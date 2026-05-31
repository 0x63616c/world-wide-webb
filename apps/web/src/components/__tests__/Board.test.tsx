import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub every tile and banner so Board renders without real data dependencies.
vi.mock("../ConnectionLostBanner", () => ({ ConnectionLostBanner: () => null }));
vi.mock("../tiles/ClimateTile", () => ({ ClimateTile: () => null }));
vi.mock("../tiles/ClockGreeting", () => ({ ClockGreeting: () => null }));
vi.mock("../tiles/ControlsTile", () => ({ ControlsTile: () => null }));
vi.mock("../tiles/DogCamTile", () => ({ DogCamTile: () => null }));
vi.mock("../tiles/EventsTile", () => ({ EventsTile: () => null }));
vi.mock("../tiles/NetworkTile", () => ({ NetworkTile: () => null }));
vi.mock("../tiles/Next12Hours", () => ({ Next12Hours: () => null }));
vi.mock("../tiles/TeslaTile", () => ({ TeslaTile: () => null }));
vi.mock("../tiles/WeatherNow", () => ({ WeatherNow: () => null }));

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
