import { vi } from "vitest";

// Global MapLibre stub for the jsdom unit project: jsdom has no WebGL, and most
// tiles only need the module to import cleanly. `maplibre-gl` is consumed via
// its default export (`import maplibregl from "maplibre-gl"`), so the stub's
// surface must live under `default`, mirroring real usage. Tests that exercise
// real map behaviour (Tesla) override this with their own local vi.mock, which
// wins over this global one.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
      setCenter: vi.fn(),
      easeTo: vi.fn(),
    })),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      getElement: vi.fn().mockReturnValue(document.createElement("div")),
    })),
    NavigationControl: vi.fn(),
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
  },
}));
