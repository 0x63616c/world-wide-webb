import type { HaEntity } from "@www/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @www/core's HA client factory before any imports that pull in ./service
// (which builds its own client from createHomeAssistantClient at module scope).
// vi.hoisted lifts mockHa's declaration above the hoisted vi.mock call below,
// which vitest otherwise hoists to the very top of the module.
const mockHa = vi.hoisted(() => ({
  isConfigured: vi.fn(() => false),
  getEntities: vi.fn(async (): Promise<HaEntity[]> => []),
}));
vi.mock("@www/core", async () => {
  const actual = await vi.importActual<typeof import("@www/core")>("@www/core");
  return { ...actual, createHomeAssistantClient: vi.fn(() => mockHa) };
});

import { config } from "./config";
import { getCameraInfo } from "./service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCameraInfo", () => {
  // The tile is driven by go2rtc (direct RTSP), NOT Home Assistant. HA has
  // crashed repeatedly in production, so an HA outage must never blank it.
  it("still populates the tile when HA is not configured", async () => {
    mockHa.isConfigured.mockReturnValue(false);

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
    expect(result?.snapshotUrl).toBeNull();
    expect(mockHa.getEntities).not.toHaveBeenCalled();
  });

  it("still populates the tile when HA is unreachable (getEntities throws)", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockRejectedValue(new Error("network error"));

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
  });

  it("still populates the tile when HA has no camera entities", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([]);

    const result = await getCameraInfo();

    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.online).toBe(true);
    expect(result?.entityId).toBeNull();
  });

  it("enriches label + entityId from a preferred HA entity", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.front_door",
        state: "idle",
        attributes: { friendly_name: "Front Door" },
        last_updated: "2024-01-01T00:00:00Z",
      },
      {
        entity_id: "camera.bedroom_cam",
        state: "streaming",
        attributes: { friendly_name: "Living Room Cam" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.bedroom_cam");
    expect(result?.label).toBe("Living Room Cam");
    expect(result?.online).toBe(true);
    expect(result?.snapshotUrl).toBeNull();
    expect(result?.streamUrl).toBe("/media/camera-stream");
  });

  it("prefers entity containing 'dog' in friendly_name", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.generic_cam_1",
        state: "idle",
        attributes: { friendly_name: "Generic Cam" },
        last_updated: "2024-01-01T00:00:00Z",
      },
      {
        entity_id: "camera.generic_cam_2",
        state: "idle",
        attributes: { friendly_name: "Dog Camera" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.generic_cam_2");
    expect(result?.label).toBe("Dog Camera");
  });

  it("falls back to first entity when no preferred entity matches", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.front_door",
        state: "idle",
        attributes: { friendly_name: "Front Door" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.entityId).toBe("camera.front_door");
    expect(result?.label).toBe("Front Door");
    expect(result?.online).toBe(true);
  });

  it("stays online even when the HA entity reports 'unavailable'", async () => {
    // go2rtc, not HA, owns liveness. An HA entity going unavailable (a common
    // symptom of HA itself being sick) must not black out a working stream.
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.bedroom",
        state: "unavailable",
        attributes: { friendly_name: "Bedroom" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.online).toBe(true);
    expect(result?.entityId).toBe("camera.bedroom");
    expect(result?.streamUrl).toBe("/media/camera-stream");
  });

  it("keeps the configured label when friendly_name is absent", async () => {
    mockHa.isConfigured.mockReturnValue(true);
    mockHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.bedroom",
        state: "idle",
        attributes: {},
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.label).toBe(config.CAMERA_LABEL);
    expect(result?.entityId).toBe("camera.bedroom");
  });
});
