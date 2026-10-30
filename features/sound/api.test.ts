import { HaError } from "@www/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sonos-write-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sonos-write-service")>()),
  sonosSeek: vi.fn(),
  sonosTransport: vi.fn(),
}));

import { api } from "./api";
import { sonosSeek, sonosTransport } from "./sonos-write-service";

const caller = api.createCaller({} as Parameters<typeof api.createCaller>[0]);

beforeEach(() => vi.resetAllMocks());

describe("sound.sonosSeek", () => {
  it.each([
    0, 12.5,
  ])("forwards room and %s seconds without changing them", async (positionSeconds) => {
    const input = { room: "media_player.example", positionSeconds };
    await expect(caller.sound.sonosSeek(input)).resolves.toBeUndefined();
    expect(sonosSeek).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    {},
    { room: "media_player.example" },
    { positionSeconds: 0 },
    { room: "", positionSeconds: 0 },
    { room: "Example", positionSeconds: 0 },
    { room: "light.example", positionSeconds: 0 },
    { room: "media_player.", positionSeconds: 0 },
    { room: "media_player.example", positionSeconds: -1 },
    { room: "media_player.example", positionSeconds: "10" },
    { room: "media_player.example", positionSeconds: Number.NaN },
    { room: "media_player.example", positionSeconds: Number.POSITIVE_INFINITY },
  ])("rejects invalid or absent input before writing: %j", async (input) => {
    await expect(caller.sound.sonosSeek(input as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(sonosSeek).not.toHaveBeenCalled();
  });

  it("uses the same HA error guard as the existing transport mutation", async () => {
    vi.mocked(sonosSeek).mockRejectedValue(new HaError(503, "unavailable"));
    vi.mocked(sonosTransport).mockRejectedValue(new HaError(503, "unavailable"));
    await expect(
      caller.sound.sonosSeek({ room: "media_player.example", positionSeconds: 10 }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      caller.sound.sonosTransport({ coordinatorIp: "media_player.example", command: "play" }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("preserves other failures as errors", async () => {
    vi.mocked(sonosSeek).mockRejectedValue(new Error("seek unsupported"));
    await expect(
      caller.sound.sonosSeek({ room: "media_player.example", positionSeconds: 10 }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
