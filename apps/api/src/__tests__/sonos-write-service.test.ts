/**
 * Unit tests for Sonos write mutations service (www-51hf.10).
 * Verifies A12: setVolume, setMute, per-room transport (play/pause/next/previous),
 * group join/leave (x-rincon:<coord>), set line-in source, grab-TV-to-Beam
 * (x-sonos-htastream spdif). All SonosClient calls are mocked — no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SonosError } from "../integrations/sonos";

// ─── mock SonosClient ─────────────────────────────────────────────────────────

type MockClient = {
  setVolume: ReturnType<typeof vi.fn>;
  setMute: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  next: ReturnType<typeof vi.fn>;
  previous: ReturnType<typeof vi.fn>;
  setAVTransportURI: ReturnType<typeof vi.fn>;
};

const mockClients: Record<string, MockClient> = {};

function makeMockClient(): MockClient {
  return {
    setVolume: vi.fn().mockResolvedValue(undefined),
    setMute: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    previous: vi.fn().mockResolvedValue(undefined),
    setAVTransportURI: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock("../integrations/sonos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/sonos")>();
  return {
    ...actual,
    SonosClient: vi.fn().mockImplementation((ip: string) => {
      if (!mockClients[ip]) {
        mockClients[ip] = makeMockClient();
      }
      return mockClients[ip];
    }),
  };
});

// ─── import after mock ────────────────────────────────────────────────────────

import {
  sonosGrabTvToBeam,
  sonosGroupJoin,
  sonosGroupLeave,
  sonosSetLineIn,
  sonosSetMute,
  sonosSetVolume,
  sonosTransport,
} from "../services/sonos-write-service";

// ─── device constants (from INTEGRATION-NOTES.md) ─────────────────────────────

const LIVING_ROOM_IP = "192.168.0.193";
const DESK_COORD_IP = "192.168.0.152";
const BEDROOM_IP = "192.168.0.63";
const BATHROOM_IP = "192.168.0.149";
const KITCHEN_IP = "192.168.0.179";

const LIVING_ROOM_UUID = "RINCON_74CA6093255801400";
const DESK_COORD_UUID = "RINCON_804AF28AAB2001400";

beforeEach(() => {
  for (const key of Object.keys(mockClients)) {
    delete mockClients[key];
  }
});

// ─── setVolume ────────────────────────────────────────────────────────────────

describe("sonosSetVolume (A12)", () => {
  it("calls setVolume on the device at the given IP", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosSetVolume({ deviceIp: LIVING_ROOM_IP, volume: 75 });
    expect(mockClients[LIVING_ROOM_IP].setVolume).toHaveBeenCalledWith(75);
  });

  it("calls setVolume on a different device IP", async () => {
    mockClients[BEDROOM_IP] = makeMockClient();
    await sonosSetVolume({ deviceIp: BEDROOM_IP, volume: 30 });
    expect(mockClients[BEDROOM_IP].setVolume).toHaveBeenCalledWith(30);
  });

  it("throws SonosError when setVolume fails (A3 — never swallows errors)", async () => {
    mockClients[BATHROOM_IP] = makeMockClient();
    mockClients[BATHROOM_IP].setVolume.mockRejectedValue(new SonosError("ECONNREFUSED"));
    await expect(sonosSetVolume({ deviceIp: BATHROOM_IP, volume: 50 })).rejects.toBeInstanceOf(
      SonosError,
    );
  });

  it("throws SonosError for out-of-range volume", async () => {
    mockClients[KITCHEN_IP] = makeMockClient();
    mockClients[KITCHEN_IP].setVolume.mockRejectedValue(
      new SonosError("SetVolume: volume 101 out of range 0-100"),
    );
    await expect(sonosSetVolume({ deviceIp: KITCHEN_IP, volume: 101 })).rejects.toBeInstanceOf(
      SonosError,
    );
  });
});

// ─── setMute ──────────────────────────────────────────────────────────────────

describe("sonosSetMute (A12)", () => {
  it("calls setMute(true) on the device", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosSetMute({ deviceIp: LIVING_ROOM_IP, muted: true });
    expect(mockClients[LIVING_ROOM_IP].setMute).toHaveBeenCalledWith(true);
  });

  it("calls setMute(false) on the device", async () => {
    mockClients[DESK_COORD_IP] = makeMockClient();
    await sonosSetMute({ deviceIp: DESK_COORD_IP, muted: false });
    expect(mockClients[DESK_COORD_IP].setMute).toHaveBeenCalledWith(false);
  });

  it("throws SonosError when setMute fails", async () => {
    mockClients[BEDROOM_IP] = makeMockClient();
    mockClients[BEDROOM_IP].setMute.mockRejectedValue(new SonosError("timeout"));
    await expect(sonosSetMute({ deviceIp: BEDROOM_IP, muted: true })).rejects.toBeInstanceOf(
      SonosError,
    );
  });
});

// ─── per-room transport ───────────────────────────────────────────────────────

describe("sonosTransport (A12)", () => {
  it("calls play() on the coordinator device", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosTransport({ coordinatorIp: LIVING_ROOM_IP, command: "play" });
    expect(mockClients[LIVING_ROOM_IP].play).toHaveBeenCalledOnce();
  });

  it("calls pause() on the coordinator device", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosTransport({ coordinatorIp: LIVING_ROOM_IP, command: "pause" });
    expect(mockClients[LIVING_ROOM_IP].pause).toHaveBeenCalledOnce();
  });

  it("calls next() on the coordinator device", async () => {
    mockClients[DESK_COORD_IP] = makeMockClient();
    await sonosTransport({ coordinatorIp: DESK_COORD_IP, command: "next" });
    expect(mockClients[DESK_COORD_IP].next).toHaveBeenCalledOnce();
  });

  it("calls previous() on the coordinator device", async () => {
    mockClients[DESK_COORD_IP] = makeMockClient();
    await sonosTransport({ coordinatorIp: DESK_COORD_IP, command: "previous" });
    expect(mockClients[DESK_COORD_IP].previous).toHaveBeenCalledOnce();
  });

  it("throws SonosError on transport failure", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    mockClients[LIVING_ROOM_IP].play.mockRejectedValue(new SonosError("SOAP fault 714"));
    await expect(
      sonosTransport({ coordinatorIp: LIVING_ROOM_IP, command: "play" }),
    ).rejects.toBeInstanceOf(SonosError);
  });
});

// ─── group join ───────────────────────────────────────────────────────────────

describe("sonosGroupJoin (A12)", () => {
  it("calls setAVTransportURI with x-rincon:<coordUuid> then play", async () => {
    mockClients[BEDROOM_IP] = makeMockClient();
    await sonosGroupJoin({ memberIp: BEDROOM_IP, coordinatorUuid: LIVING_ROOM_UUID });
    expect(mockClients[BEDROOM_IP].setAVTransportURI).toHaveBeenCalledWith(
      `x-rincon:${LIVING_ROOM_UUID}`,
      "",
    );
    expect(mockClients[BEDROOM_IP].play).toHaveBeenCalledOnce();
  });

  it("uses the correct coordinator UUID in the rincon URI", async () => {
    mockClients[KITCHEN_IP] = makeMockClient();
    await sonosGroupJoin({ memberIp: KITCHEN_IP, coordinatorUuid: DESK_COORD_UUID });
    const [uri] = mockClients[KITCHEN_IP].setAVTransportURI.mock.calls[0] as [string, string];
    expect(uri).toBe(`x-rincon:${DESK_COORD_UUID}`);
  });

  it("throws SonosError when setAVTransportURI fails", async () => {
    mockClients[BATHROOM_IP] = makeMockClient();
    mockClients[BATHROOM_IP].setAVTransportURI.mockRejectedValue(new SonosError("network timeout"));
    await expect(
      sonosGroupJoin({ memberIp: BATHROOM_IP, coordinatorUuid: LIVING_ROOM_UUID }),
    ).rejects.toBeInstanceOf(SonosError);
  });
});

// ─── group leave ──────────────────────────────────────────────────────────────

describe("sonosGroupLeave (A12)", () => {
  it("calls setAVTransportURI with x-rincon-stream:<memberUuid>:0 to go standalone", async () => {
    const MEMBER_UUID = "RINCON_804AF28CFD6801400";
    mockClients[BEDROOM_IP] = makeMockClient();
    await sonosGroupLeave({ memberIp: BEDROOM_IP, memberUuid: MEMBER_UUID });
    expect(mockClients[BEDROOM_IP].setAVTransportURI).toHaveBeenCalledWith(
      `x-rincon-stream:${MEMBER_UUID}:0`,
      "",
    );
  });

  it("throws SonosError when leave fails", async () => {
    mockClients[KITCHEN_IP] = makeMockClient();
    mockClients[KITCHEN_IP].setAVTransportURI.mockRejectedValue(new SonosError("ECONNREFUSED"));
    await expect(
      sonosGroupLeave({ memberIp: KITCHEN_IP, memberUuid: "RINCON_74CA60AA5F4C01400" }),
    ).rejects.toBeInstanceOf(SonosError);
  });
});

// ─── set line-in ──────────────────────────────────────────────────────────────

describe("sonosSetLineIn (A12)", () => {
  it("calls setAVTransportURI with x-rincon-stream:<sourceUuid>:0 then play", async () => {
    const SOURCE_UUID = "RINCON_804AF28AAB2001400";
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosSetLineIn({ deviceIp: LIVING_ROOM_IP, sourceUuid: SOURCE_UUID });
    expect(mockClients[LIVING_ROOM_IP].setAVTransportURI).toHaveBeenCalledWith(
      `x-rincon-stream:${SOURCE_UUID}:0`,
      "",
    );
    expect(mockClients[LIVING_ROOM_IP].play).toHaveBeenCalledOnce();
  });

  it("throws SonosError when setAVTransportURI fails", async () => {
    mockClients[DESK_COORD_IP] = makeMockClient();
    mockClients[DESK_COORD_IP].setAVTransportURI.mockRejectedValue(new SonosError("HTTP 500"));
    await expect(
      sonosSetLineIn({ deviceIp: DESK_COORD_IP, sourceUuid: "RINCON_74CA6093255801400" }),
    ).rejects.toBeInstanceOf(SonosError);
  });
});

// ─── grab TV audio to Beam ────────────────────────────────────────────────────

describe("sonosGrabTvToBeam (A12)", () => {
  it("calls setAVTransportURI with x-sonos-htastream:<beamUuid>:spdif then play", async () => {
    const BEAM_UUID = "RINCON_74CA6093255801400";
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    await sonosGrabTvToBeam({ beamIp: LIVING_ROOM_IP, beamUuid: BEAM_UUID });
    expect(mockClients[LIVING_ROOM_IP].setAVTransportURI).toHaveBeenCalledWith(
      `x-sonos-htastream:${BEAM_UUID}:spdif`,
      "",
    );
    expect(mockClients[LIVING_ROOM_IP].play).toHaveBeenCalledOnce();
  });

  it("throws SonosError when SOAP POST fails", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    mockClients[LIVING_ROOM_IP].setAVTransportURI.mockRejectedValue(
      new SonosError("SOAP fault 701"),
    );
    await expect(
      sonosGrabTvToBeam({ beamIp: LIVING_ROOM_IP, beamUuid: "RINCON_74CA6093255801400" }),
    ).rejects.toBeInstanceOf(SonosError);
  });
});
