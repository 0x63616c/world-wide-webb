import { readFileSync } from "node:fs";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context";

vi.mock("@features/ctrl/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/ctrl/service")>()),
  getControlsState: vi.fn(),
  toggleControl: vi.fn(),
  setLampScene: vi.fn(),
  setLampColor: vi.fn(),
  setWhiteKelvin: vi.fn(),
  setLampBrightness: vi.fn(),
  setLampMode: vi.fn(),
}));
vi.mock("@features/sound/sonos-sound-system-service", () => ({
  getSoundSystem: vi.fn(),
  calibrateSoundSystem: vi.fn(),
  clearSoundSystemCalibration: vi.fn(),
}));
vi.mock("@features/sound/sonos-write-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@features/sound/sonos-write-service")>()),
  sonosSeek: vi.fn(),
}));

import {
  getControlsState,
  setLampBrightness,
  setLampColor,
  setLampMode,
  setLampScene,
  setWhiteKelvin,
  toggleControl,
} from "@features/ctrl/service";
import { getSoundSystem } from "@features/sound/sonos-sound-system-service";
import { sonosSeek } from "@features/sound/sonos-write-service";
import { appRouter } from "../trpc/routers";

function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../docs/contracts/native-panel/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

async function request(path: string, input?: unknown, mutation = false) {
  return fetchRequestHandler({
    endpoint: "/trpc",
    router: appRouter,
    createContext: () => ({}) as Context,
    req: new Request(
      `http://localhost/trpc/${path}${!mutation && input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ""}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        ...(mutation ? { body: JSON.stringify(input) } : {}),
      },
    ),
  });
}

beforeEach(() => vi.resetAllMocks());

describe("native-panel plain tRPC HTTP contracts through the generated app router", () => {
  it.each([
    "controls",
    "controls-party",
    "controls-legacy",
  ])("preserves the %s fixture, including optional-field absence", async (name) => {
    const expected = fixture(name);
    vi.mocked(getControlsState).mockResolvedValue(expected.result.data);
    for (const input of [undefined, {}]) {
      const response = await request("controls.list", input);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
    }
  });

  it.each([
    "sound-system",
    "sound-system-legacy",
  ])("preserves the %s fixture, including optional-field absence", async (name) => {
    const expected = fixture(name);
    vi.mocked(getSoundSystem).mockResolvedValue(expected.result.data);
    for (const input of [undefined, {}]) {
      const response = await request("sound.soundSystem", input);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
    }
  });

  it.each([
    ["toggle", { key: "lamps", on: true }, toggleControl, ["lamps", true]],
    ["setLampScene", { scene: "white" }, setLampScene, ["white"]],
    ["setLampColor", { slot: "red" }, setLampColor, ["red", undefined]],
    ["setWhiteKelvin", { kelvin: 2700 }, setWhiteKelvin, [2700]],
    ["setLampBrightness", { pct: 50 }, setLampBrightness, [50]],
    ["setLampMode", { mode: "party" }, setLampMode, ["party", undefined]],
  ] as const)("keeps existing controls.%s inputs and accepts old and new output shapes", async (name, input, service, args) => {
    for (const fixtureName of ["controls-legacy", "controls-party"]) {
      const expected = fixture(fixtureName);
      vi.mocked(service).mockResolvedValueOnce(expected.result.data);
      const response = await request(`controls.${name}`, input, true);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(service).toHaveBeenLastCalledWith(...args);
    }
  });

  it("serves sonosSeek with the same void response as existing Sonos mutations", async () => {
    const input = { room: "media_player.example", positionSeconds: 12.5 };
    const response = await request("sound.sonosSeek", input, true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture("sonos-seek"));
    expect(sonosSeek).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("rejects missing seek input over HTTP before calling the device client", async () => {
    const response = await request("sound.sonosSeek", {}, true);
    expect(response.status).toBe(400);
    expect(sonosSeek).not.toHaveBeenCalled();
  });
});
