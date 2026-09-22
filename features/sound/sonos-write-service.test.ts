import { describe, expect, it, vi } from "vitest";
import {
  sonosGroupJoin,
  sonosGroupJoinAll,
  sonosGroupJoinAllToTv,
  sonosSetVolume,
} from "./sonos-write-service";

describe("HA sound writes", () => {
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
