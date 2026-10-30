import { describe, expect, it } from "vitest";
import { createMemoryCalibrationStore } from "./calibration-store";
import {
  calibrateSoundSystem,
  clearSoundSystemCalibration,
  getSoundSystem,
  roomFromHaEntity,
} from "./sonos-sound-system-service";

const bedroom = {
  entity_id: "media_player.bedroom",
  state: "playing",
  last_updated: "2026-08-11T00:00:00Z",
  attributes: {
    friendly_name: "Bedroom",
    group_members: ["media_player.desk", "media_player.bedroom"],
    volume_level: 0.33,
    is_volume_muted: false,
    source: "Line-in",
    media_title: "Desk audio",
  },
};

describe("Home Assistant sound-system snapshot", () => {
  it("uses HA entity identity and distinguishes idle from unavailable", async () => {
    const snapshot = await getSoundSystem(
      {
        isConfigured: () => true,
        getEntities: async () => [
          bedroom,
          { ...bedroom, entity_id: "media_player.tv", attributes: {} },
        ],
      },
      createMemoryCalibrationStore(),
    );
    expect(snapshot.rooms).toHaveLength(1);
    expect(snapshot.rooms[0]).toMatchObject({
      uuid: "media_player.bedroom",
      coordinatorUuid: "media_player.desk",
      volume: 33,
      baseline: null,
      sourceKind: "line-in",
      groupStatus: "Following desk",
      availability: "available",
    });
    expect(snapshot.diagnostics.controlPlane).toBe("home-assistant");
  });

  it("does not call a stopped-but-online player off", () => {
    const room = roomFromHaEntity({
      ...bedroom,
      state: "idle",
      attributes: { ...bedroom.attributes, group_members: ["media_player.bedroom"] },
    });
    expect(room).toMatchObject({
      transportState: "STOPPED",
      availability: "available",
      groupStatus: "Standalone",
    });
  });

  it("reports each room's stored calibration baseline alongside its raw volume", async () => {
    const snapshot = await getSoundSystem(
      { isConfigured: () => true, getEntities: async () => [bedroom] },
      createMemoryCalibrationStore({ "media_player.bedroom": 66 }),
    );
    expect(snapshot.rooms[0]).toMatchObject({ volume: 33, baseline: 66 });
  });
});

describe("calibration", () => {
  const ha = {
    isConfigured: () => true,
    getEntities: async () => [
      bedroom,
      {
        ...bedroom,
        entity_id: "media_player.kitchen",
        attributes: { ...bedroom.attributes, friendly_name: "Kitchen", volume_level: 0.73 },
      },
      {
        ...bedroom,
        entity_id: "media_player.bathroom",
        attributes: { ...bedroom.attributes, friendly_name: "Bathroom", volume_level: 0 },
      },
    ],
  };

  it("stores raw*2 for every audible room from a FRESH Home Assistant read", async () => {
    const store = createMemoryCalibrationStore({ "media_player.bathroom": 20 });
    const written = await calibrateSoundSystem(ha, store);
    // Kitchen at raw 73 gets baseline 146 (>100, uncapped); a silent room keeps its old one.
    expect(written).toEqual({ "media_player.bedroom": 66, "media_player.kitchen": 146 });
    expect(store.snapshot()).toEqual({
      "media_player.bedroom": 66,
      "media_player.kitchen": 146,
      "media_player.bathroom": 20,
    });
  });

  it("clear drops every baseline entirely so rooms fall back to raw volume", async () => {
    const store = createMemoryCalibrationStore({
      "media_player.bedroom": 66,
      "media_player.kitchen": 146,
    });
    await clearSoundSystemCalibration(store);
    expect(store.snapshot()).toEqual({});
    const snapshot = await getSoundSystem(ha, store);
    expect(snapshot.rooms.every((room) => room.baseline === null)).toBe(true);
  });
});
