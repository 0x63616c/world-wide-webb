import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ha singleton before any imports that pull it in.
vi.mock("../integrations/homeassistant", () => {
  const ha = {
    isConfigured: vi.fn(() => false),
    getEntities: vi.fn(async () => []),
    cameraProxyUrl: vi.fn(
      (entityId: string) => `http://ha.local:8123/api/camera_proxy/${entityId}`,
    ),
  };
  return { ha, HomeAssistantClient: vi.fn(() => ha) };
});

import { env } from "../env";
import { ha } from "../integrations/homeassistant";
import { getCameraInfo } from "../services/camera-service";

const mockedHa = ha as unknown as {
  isConfigured: ReturnType<typeof vi.fn>;
  getEntities: ReturnType<typeof vi.fn>;
  cameraProxyUrl: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCameraInfo", () => {
  // The tile is driven by go2rtc (direct RTSP), NOT Home Assistant. HA has
  // crashed repeatedly in production, so an HA outage must never blank it.
  it("still populates the tile when HA is not configured", async () => {
    mockedHa.isConfigured.mockReturnValue(false);

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(env.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
    expect(result?.snapshotUrl).toBeNull();
    expect(mockedHa.getEntities).not.toHaveBeenCalled();
  });

  it("still populates the tile when HA is unreachable (getEntities throws)", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockRejectedValue(new Error("network error"));

    const result = await getCameraInfo();

    expect(result).not.toBeNull();
    expect(result?.label).toBe(env.CAMERA_LABEL);
    expect(result?.online).toBe(true);
    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.entityId).toBeNull();
  });

  it("still populates the tile when HA has no camera entities", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([]);

    const result = await getCameraInfo();

    expect(result?.streamUrl).toBe("/media/camera-stream");
    expect(result?.online).toBe(true);
    expect(result?.entityId).toBeNull();
  });

  it("enriches label + entityId from a preferred HA entity", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
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
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
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
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
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
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
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
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.bedroom",
        state: "idle",
        attributes: {},
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result?.label).toBe(env.CAMERA_LABEL);
    expect(result?.entityId).toBe("camera.bedroom");
  });
});
