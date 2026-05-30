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
  it("returns fallback when HA is not configured", async () => {
    mockedHa.isConfigured.mockReturnValue(false);

    const result = await getCameraInfo();

    expect(result).toEqual({
      label: "Living Room",
      online: false,
      snapshotUrl: null,
      streamUrl: null,
      entityId: null,
    });
    expect(mockedHa.getEntities).not.toHaveBeenCalled();
  });

  it("returns fallback when getEntities throws", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockRejectedValue(new Error("network error"));

    const result = await getCameraInfo();

    expect(result).toEqual({
      label: "Living Room",
      online: false,
      snapshotUrl: null,
      streamUrl: null,
      entityId: null,
    });
  });

  it("returns fallback when no camera entities exist", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([]);

    const result = await getCameraInfo();

    expect(result).toEqual({
      label: "Living Room",
      online: false,
      snapshotUrl: null,
      streamUrl: null,
      entityId: null,
    });
  });

  it("prefers entity containing 'living' in entity_id", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.front_door",
        state: "idle",
        attributes: { friendly_name: "Front Door" },
        last_updated: "2024-01-01T00:00:00Z",
      },
      {
        entity_id: "camera.living_room_dog_cam",
        state: "streaming",
        attributes: { friendly_name: "Living Room Dog Cam" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result.entityId).toBe("camera.living_room_dog_cam");
    expect(result.label).toBe("Living Room Dog Cam");
    expect(result.online).toBe(true);
    expect(result.snapshotUrl).toBe(
      "http://ha.local:8123/api/camera_proxy/camera.living_room_dog_cam",
    );
    expect(result.streamUrl).toBeNull();
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

    expect(result.entityId).toBe("camera.generic_cam_2");
    expect(result.label).toBe("Dog Camera");
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

    expect(result.entityId).toBe("camera.front_door");
    expect(result.label).toBe("Front Door");
    expect(result.online).toBe(true);
  });

  it("marks entity with state 'unavailable' as offline", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.living_room",
        state: "unavailable",
        attributes: { friendly_name: "Living Room" },
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result.online).toBe(false);
    expect(result.entityId).toBe("camera.living_room");
  });

  it("uses entity_id as label when friendly_name is absent", async () => {
    mockedHa.isConfigured.mockReturnValue(true);
    mockedHa.getEntities.mockResolvedValue([
      {
        entity_id: "camera.living_room",
        state: "idle",
        attributes: {},
        last_updated: "2024-01-01T00:00:00Z",
      },
    ]);

    const result = await getCameraInfo();

    expect(result.label).toBe("Living Room");
  });
});
