/**
 * Registry-shape tests for the Task-11 entries (Activity, DogCam,
 * Frontend Logs). The behavior these assert used to live in hand-wired tile
 * plumbing (WakesTile's own PinGateModal, FrontendLogsTile's own tap handler);
 * now it is declarative registry data, so the tests pin the declarations:
 * Activity stays PIN-gated (sensitive), and the Frontend Logs action deep-links
 * the Settings Logs page through settings-overlay-store.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// MapLibre (via the tesla wiring, imported transitively by the detail
// registry) calls window.URL.createObjectURL at import time , unavailable in
// jsdom. Shape mirrors registry-guards.test.ts.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
      setCenter: vi.fn(),
    })),
  },
}));

import { closeSettings, useSettingsOverlay } from "../../../../lib/settings-overlay-store";
import { TILE_REGISTRY } from "../../../../lib/tile-registry";
import { getTileDetailEntry } from "../registry";

describe("tile detail registry , Task 11 entries", () => {
  it("Activity is a PIN-gated (sensitive) page titled 'Activity'", () => {
    const entry = getTileDetailEntry("tile_wakes");
    expect(entry?.kind).toBe("page");
    if (entry?.kind !== "page") throw new Error("expected a page entry");
    expect(entry.title).toBe("Activity");
    expect(entry.sensitive).toBe(true);
    expect(entry.defaultSlug).toBe("activity");
  });

  it("DogCam is a single-variant page", () => {
    for (const [tileId, title] of [["tile_dogcam", "Living Room Cam"]] as const) {
      const entry = getTileDetailEntry(tileId);
      expect(entry?.kind).toBe("page");
      if (entry?.kind !== "page") throw new Error("expected a page entry");
      expect(entry.title).toBe(title);
      // No hand-wired gate: neither camera preview is PIN-gated.
      expect(entry.sensitive).toBeUndefined();
    }
  });

  it("Frontend Logs is an action that deep-links Settings → Logs", () => {
    const entry = getTileDetailEntry("tile_felogs");
    expect(entry?.kind).toBe("action");
    if (entry?.kind !== "action") throw new Error("expected an action entry");
    closeSettings(); // start from a closed overlay so the assertion is about THIS run
    entry.run();
    // The action opens the Settings overlay landed on the Logs page.
    const { result } = renderHook(() => useSettingsOverlay());
    expect(result.current.open).toBe(true);
    expect(result.current.page).toBe("logs");
    closeSettings();
  });

  it("EVERY board tile resolves to a detail entry (completeness guard)", () => {
    // The board's tap/keyboard path resolves ONLY through this registry now
    // (the modal fallback is gone), so a tile without an entry would silently
    // no-op on tap. Fail CI instead.
    for (const tile of TILE_REGISTRY) {
      expect(getTileDetailEntry(tile.id), `no detail entry for ${tile.id}`).toBeDefined();
    }
  });
});
