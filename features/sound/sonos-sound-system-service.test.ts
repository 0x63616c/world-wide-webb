import { describe, expect, it, vi } from "vitest";
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
  it("reads optional playback fields from the existing snapshot, preserving fractional seconds and sample time", async () => {
    const getEntities = vi.fn().mockResolvedValue([
      {
        ...bedroom,
        attributes: {
          ...bedroom.attributes,
          media_position: 12.5,
          media_duration: 180.75,
          media_position_updated_at: "2026-01-01T13:00:00+01:00",
        },
      },
    ]);
    const { rooms } = await getSoundSystem(
      { isConfigured: () => true, getEntities },
      createMemoryCalibrationStore(),
    );
    expect(rooms[0]).toMatchObject({
      position: 12.5,
      duration: 180.75,
      positionAt: "2026-01-01T12:00:00.000Z",
    });
    expect(getEntities).toHaveBeenCalledExactlyOnceWith("media_player");
  });

  it("omits playback fields when the source has none (including line-in)", () => {
    const room = roomFromHaEntity(bedroom);
    for (const field of ["position", "duration", "positionAt"])
      expect(room).not.toHaveProperty(field);
  });

  it.each([
    undefined,
    null,
    "12",
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("omits invalid numeric playback attributes: %s", (value) => {
    const room = roomFromHaEntity({
      ...bedroom,
      attributes: {
        ...bedroom.attributes,
        media_position: value,
        media_duration: value,
        media_position_updated_at: "2026-01-01T12:00:00Z",
      },
    });
    for (const field of ["position", "duration", "positionAt"])
      expect(room).not.toHaveProperty(field);
  });

  it.each([
    undefined,
    null,
    "invalid",
    "2026-01-01T12:00:00",
    "2026-02-30T12:00:00Z",
  ])("keeps valid position/duration without inventing a timestamp: %s", (time) => {
    const room = roomFromHaEntity({
      ...bedroom,
      state: "paused",
      attributes: {
        ...bedroom.attributes,
        media_position: 0,
        media_duration: 0,
        media_position_updated_at: time,
      },
    });
    expect(room).toMatchObject({ position: 0, duration: 0 });
    expect(room).not.toHaveProperty("positionAt");
  });

  it("keeps position and duration independently optional", () => {
    const positionOnly = roomFromHaEntity({
      ...bedroom,
      attributes: { ...bedroom.attributes, media_position: 10 },
    });
    expect(positionOnly?.position).toBe(10);
    expect(positionOnly).not.toHaveProperty("duration");
    const durationOnly = roomFromHaEntity({
      ...bedroom,
      attributes: { ...bedroom.attributes, media_duration: 100 },
    });
    expect(durationOnly?.duration).toBe(100);
    expect(durationOnly).not.toHaveProperty("position");
    expect(durationOnly).not.toHaveProperty("positionAt");
  });

  it.each([
    "unavailable",
    "unknown",
    "off",
  ])("omits stale playback fields for %s players", (state) => {
    const room = roomFromHaEntity({
      ...bedroom,
      state,
      attributes: {
        ...bedroom.attributes,
        media_position: 12,
        media_duration: 180,
        media_position_updated_at: "2026-01-01T12:00:00Z",
      },
    });
    for (const field of ["position", "duration", "positionAt"])
      expect(room).not.toHaveProperty(field);
  });

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
