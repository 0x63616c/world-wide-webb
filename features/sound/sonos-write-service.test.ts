import { describe, expect, it, vi } from "vitest";
import {
  sonosGroupJoin,
  sonosGroupJoinAll,
  sonosGroupJoinAllToTv,
  sonosSeek,
  sonosSetVolume,
} from "./sonos-write-service";

describe("HA sound writes", () => {
  it.each([
    0, 12.5, 3600,
  ])("seeks to %s seconds through the same HA client", async (positionSeconds) => {
    const callService = vi.fn().mockResolvedValue(undefined);
    await expect(
      sonosSeek({ room: "media_player.example", positionSeconds }, { callService }),
    ).resolves.toBeUndefined();
    expect(callService).toHaveBeenCalledExactlyOnceWith("media_player", "media_seek", {
      entity_id: "media_player.example",
      seek_position: positionSeconds,
    });
  });

  it("propagates seek failures without claiming success or retrying", async () => {
    const error = new Error("seek unsupported");
    const callService = vi.fn().mockRejectedValue(error);
    await expect(
      sonosSeek({ room: "media_player.example", positionSeconds: 10 }, { callService }),
    ).rejects.toBe(error);
    expect(callService).toHaveBeenCalledOnce();
  });

  it("sends volume and grouping commands to Home Assistant", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const ha = { callService };
    await sonosSetVolume({ deviceIp: "media_player.kitchen", volume: 24 }, ha);
    await sonosGroupJoin(
      { memberIp: "media_player.kitchen", coordinatorUuid: "media_player.desk" },
      ha,
    );
    expect(callService).toHaveBeenNthCalledWith(1, "media_player", "volume_set", {
      entity_id: "media_player.kitchen",
      volume_level: 0.24,
    });
    expect(callService).toHaveBeenNthCalledWith(2, "media_player", "join", {
      entity_id: "media_player.desk",
      group_members: ["media_player.kitchen"],
    });
  });

  it("joins every requested room to one coordinator in a single Home Assistant command", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);

    await sonosGroupJoinAll(
      {
        coordinatorEntityId: "media_player.desk",
        memberEntityIds: ["media_player.kitchen", "media_player.bathroom"],
      },
      { callService },
    );

    expect(callService).toHaveBeenCalledWith("media_player", "join", {
      entity_id: "media_player.desk",
      group_members: ["media_player.kitchen", "media_player.bathroom"],
    });
  });

  it("TV mode puts the TV room on its TV input, then joins the rest onto it", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);

    await sonosGroupJoinAllToTv(
      {
        tvEntityId: "media_player.living_room",
        memberEntityIds: ["media_player.desk", "media_player.kitchen"],
      },
      { callService },
    );

    expect(callService).toHaveBeenNthCalledWith(1, "media_player", "select_source", {
      entity_id: "media_player.living_room",
      source: "TV",
    });
    expect(callService).toHaveBeenNthCalledWith(2, "media_player", "join", {
      entity_id: "media_player.living_room",
      group_members: ["media_player.desk", "media_player.kitchen"],
    });
  });

  it("TV mode with nothing to join only switches the source", async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    await sonosGroupJoinAllToTv(
      { tvEntityId: "media_player.living_room", memberEntityIds: [] },
      { callService },
    );
    expect(callService).toHaveBeenCalledTimes(1);
  });
});
