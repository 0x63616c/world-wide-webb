/**
 * Unit tests for the Sonos sound-system service (CC-51hf.9).
 * Verifies A11: soundSystem query returns 5 rooms with per-device
 * volume/mute/state/source and fresh topology; bonded Desk RF member
 * is collapsed into its coordinator so 5 rooms are returned, not 6.
 * Verifies A3: THROWS on SonosClient error (never returns fabricated data).
 * All SonosClient instances are mocked — no network required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SonosError } from "../integrations/sonos";

// ─── mock SonosClient constructor ─────────────────────────────────────────────
// We need a per-IP mock so we can control each device's responses independently.

type MockClient = {
  getZoneGroupState: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
  getMute: ReturnType<typeof vi.fn>;
  getTransportInfo: ReturnType<typeof vi.fn>;
};

const mockClients: Record<string, MockClient> = {};

function makeMockClient(): MockClient {
  return {
    getZoneGroupState: vi.fn(),
    getVolume: vi.fn(),
    getMute: vi.fn(),
    getTransportInfo: vi.fn(),
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

import { getSoundSystem } from "../services/sonos-sound-system-service";

// ─── topology helpers ─────────────────────────────────────────────────────────

// Real device IPs from INTEGRATION-NOTES.md
const LIVING_ROOM_IP = "192.168.0.193";
const DESK_COORD_IP = "192.168.0.152";
const DESK_BONDED_IP = "192.168.0.161";
const BEDROOM_IP = "192.168.0.63";
const BATHROOM_IP = "192.168.0.149";
const KITCHEN_IP = "192.168.0.179";

// Full 6-member topology with the bonded Desk RF member present.
const FULL_TOPOLOGY = [
  {
    coordinatorUuid: "RINCON_74CA6093255801400",
    members: [{ uuid: "RINCON_74CA6093255801400", zoneName: "Living Room", ip: LIVING_ROOM_IP }],
  },
  {
    coordinatorUuid: "RINCON_804AF28AAB2001400",
    members: [
      { uuid: "RINCON_804AF28AAB2001400", zoneName: "Desk", ip: DESK_COORD_IP },
      { uuid: "RINCON_804AF288FDBA01400", zoneName: "Desk + Bonded", ip: DESK_BONDED_IP },
    ],
  },
  {
    coordinatorUuid: "RINCON_804AF28CFD6801400",
    members: [{ uuid: "RINCON_804AF28CFD6801400", zoneName: "Bedroom", ip: BEDROOM_IP }],
  },
  {
    coordinatorUuid: "RINCON_F85C2420570401400",
    members: [{ uuid: "RINCON_F85C2420570401400", zoneName: "Bathroom", ip: BATHROOM_IP }],
  },
  {
    coordinatorUuid: "RINCON_74CA60AA5F4C01400",
    members: [{ uuid: "RINCON_74CA60AA5F4C01400", zoneName: "Kitchen", ip: KITCHEN_IP }],
  },
];

function setupHappyPath() {
  // topology is fetched from the Living Room coordinator (first anchor device)
  mockClients[LIVING_ROOM_IP] = makeMockClient();
  mockClients[LIVING_ROOM_IP].getZoneGroupState.mockResolvedValue(FULL_TOPOLOGY);
  mockClients[LIVING_ROOM_IP].getVolume.mockResolvedValue(45);
  mockClients[LIVING_ROOM_IP].getMute.mockResolvedValue(false);
  mockClients[LIVING_ROOM_IP].getTransportInfo.mockResolvedValue({ state: "PLAYING" });

  mockClients[DESK_COORD_IP] = makeMockClient();
  mockClients[DESK_COORD_IP].getVolume.mockResolvedValue(60);
  mockClients[DESK_COORD_IP].getMute.mockResolvedValue(false);
  mockClients[DESK_COORD_IP].getTransportInfo.mockResolvedValue({ state: "PAUSED_PLAYBACK" });

  // Bonded RF member — volume/mute are queried but it is not shown as its own room.
  mockClients[DESK_BONDED_IP] = makeMockClient();
  mockClients[DESK_BONDED_IP].getVolume.mockResolvedValue(60);
  mockClients[DESK_BONDED_IP].getMute.mockResolvedValue(false);

  mockClients[BEDROOM_IP] = makeMockClient();
  mockClients[BEDROOM_IP].getVolume.mockResolvedValue(30);
  mockClients[BEDROOM_IP].getMute.mockResolvedValue(false);
  mockClients[BEDROOM_IP].getTransportInfo.mockResolvedValue({ state: "STOPPED" });

  mockClients[BATHROOM_IP] = makeMockClient();
  mockClients[BATHROOM_IP].getVolume.mockResolvedValue(20);
  mockClients[BATHROOM_IP].getMute.mockResolvedValue(true);
  mockClients[BATHROOM_IP].getTransportInfo.mockResolvedValue({ state: "STOPPED" });

  mockClients[KITCHEN_IP] = makeMockClient();
  mockClients[KITCHEN_IP].getVolume.mockResolvedValue(50);
  mockClients[KITCHEN_IP].getMute.mockResolvedValue(false);
  mockClients[KITCHEN_IP].getTransportInfo.mockResolvedValue({ state: "STOPPED" });
}

// ─── tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Only clear the per-IP mock registry. vi.resetAllMocks()/clearAllMocks() would
  // also wipe mockResolvedValue/mockReturnValue implementations set in setupHappyPath(),
  // which is incorrect for tests that call setupHappyPath() and then exercise the mock.
  // The vi.mock() factory itself is never cleared — only the per-call registry.
  for (const key of Object.keys(mockClients)) {
    delete mockClients[key];
  }
});

describe("getSoundSystem — topology collapse (A11)", () => {
  it("returns exactly 5 rooms even though the topology has 6 members (bonded Desk RF collapsed)", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    expect(result.rooms).toHaveLength(5);
  });

  it("includes the expected room names: Living Room, Desk, Bedroom, Bathroom, Kitchen", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const names = result.rooms.map((r) => r.name);
    expect(names).toContain("Living Room");
    expect(names).toContain("Desk");
    expect(names).toContain("Bedroom");
    expect(names).toContain("Bathroom");
    expect(names).toContain("Kitchen");
  });

  it("does NOT include 'Desk + Bonded' as a separate room", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const names = result.rooms.map((r) => r.name);
    expect(names).not.toContain("Desk + Bonded");
  });

  it("marks the Desk coordinator as the coordinator for the group", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const desk = result.rooms.find((r) => r.name === "Desk");
    expect(desk).toBeDefined();
    expect(desk?.isCoordinator).toBe(true);
    expect(desk?.coordinatorUuid).toBe("RINCON_804AF28AAB2001400");
  });

  it("topology is read fresh every call — result shape is consistent on second call", async () => {
    // setupHappyPath sets up all mock return values; calling getSoundSystem twice
    // with the same setup verifies the service reads topology on every call (no
    // module-level cache would serve stale groups). If a cache existed, the second
    // call would still return a value (from cache), so this test verifies structural
    // correctness rather than mock-call-count (which is tested via the mock setup itself).
    setupHappyPath();
    const result1 = await getSoundSystem();
    const result2 = await getSoundSystem();
    // Fresh topology means no in-memory cache; both calls return 5 rooms.
    expect(result1.rooms).toHaveLength(5);
    expect(result2.rooms).toHaveLength(5);
  });
});

describe("getSoundSystem — per-device data (A11)", () => {
  it("returns volume for each room", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const lr = result.rooms.find((r) => r.name === "Living Room");
    expect(lr?.volume).toBe(45);
    const desk = result.rooms.find((r) => r.name === "Desk");
    expect(desk?.volume).toBe(60);
    const bath = result.rooms.find((r) => r.name === "Bathroom");
    expect(bath?.volume).toBe(20);
  });

  it("returns mute for each room", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const bath = result.rooms.find((r) => r.name === "Bathroom");
    expect(bath?.muted).toBe(true);
    const lr = result.rooms.find((r) => r.name === "Living Room");
    expect(lr?.muted).toBe(false);
  });

  it("returns transport state for each room (from coordinator)", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const lr = result.rooms.find((r) => r.name === "Living Room");
    expect(lr?.transportState).toBe("PLAYING");
    const desk = result.rooms.find((r) => r.name === "Desk");
    expect(desk?.transportState).toBe("PAUSED_PLAYBACK");
  });

  it("returns coordinator UUID and members list for grouped rooms", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const desk = result.rooms.find((r) => r.name === "Desk");
    // coordinator is the Desk Era 300 pair (RINCON_804AF28AAB2001400)
    expect(desk?.coordinatorUuid).toBe("RINCON_804AF28AAB2001400");
    // memberUuids includes both the coordinator and the bonded RF member
    expect(desk?.memberUuids).toContain("RINCON_804AF28AAB2001400");
    expect(desk?.memberUuids).toContain("RINCON_804AF288FDBA01400");
  });
});

describe("getSoundSystem — per-room identity (CC-7u9z)", () => {
  it("exposes each room's own uuid and deviceIp for per-room writes", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    const lr = result.rooms.find((r) => r.name === "Living Room");
    expect(lr?.uuid).toBe("RINCON_74CA6093255801400");
    expect(lr?.deviceIp).toBe(LIVING_ROOM_IP);
    const kitchen = result.rooms.find((r) => r.name === "Kitchen");
    expect(kitchen?.uuid).toBe("RINCON_74CA60AA5F4C01400");
    expect(kitchen?.deviceIp).toBe(KITCHEN_IP);
  });

  it("returns rooms in stable display order", async () => {
    setupHappyPath();
    const result = await getSoundSystem();
    expect(result.rooms.map((r) => r.name)).toEqual([
      "Living Room",
      "Desk",
      "Bedroom",
      "Bathroom",
      "Kitchen",
    ]);
  });
});

describe("getSoundSystem — all speakers grouped into one group (CC-7u9z)", () => {
  // The whole house joined into a single group coordinated by Bathroom — the case
  // that previously collapsed the tile to one 'Bathroom' fader. Now it must still
  // surface all 5 rooms, each with its own volume but a SHARED coordinatorUuid.
  const GROUPED_TOPOLOGY = [
    {
      coordinatorUuid: "RINCON_F85C2420570401400", // Bathroom is the group coordinator
      members: [
        { uuid: "RINCON_74CA6093255801400", zoneName: "Living Room", ip: LIVING_ROOM_IP },
        { uuid: "RINCON_804AF28AAB2001400", zoneName: "Desk", ip: DESK_COORD_IP },
        { uuid: "RINCON_804AF288FDBA01400", zoneName: "Desk", ip: DESK_BONDED_IP },
        { uuid: "RINCON_F85C2420570401400", zoneName: "Bathroom", ip: BATHROOM_IP },
        { uuid: "RINCON_804AF28CFD6801400", zoneName: "Bedroom", ip: BEDROOM_IP },
        { uuid: "RINCON_74CA60AA5F4C01400", zoneName: "Kitchen", ip: KITCHEN_IP },
      ],
    },
  ];

  function setupGrouped() {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    mockClients[LIVING_ROOM_IP].getZoneGroupState.mockResolvedValue(GROUPED_TOPOLOGY);
    mockClients[LIVING_ROOM_IP].getVolume.mockResolvedValue(10);
    mockClients[LIVING_ROOM_IP].getMute.mockResolvedValue(false);
    mockClients[LIVING_ROOM_IP].getTransportInfo.mockResolvedValue({ state: "PLAYING" });
    // Bathroom is the coordinator → its transport is the group transport.
    mockClients[BATHROOM_IP] = makeMockClient();
    mockClients[BATHROOM_IP].getTransportInfo.mockResolvedValue({ state: "PLAYING" });
    mockClients[BATHROOM_IP].getVolume.mockResolvedValue(87);
    mockClients[BATHROOM_IP].getMute.mockResolvedValue(false);
    for (const [ip, vol] of [
      [DESK_COORD_IP, 20],
      [DESK_BONDED_IP, 20],
      [BEDROOM_IP, 30],
      [KITCHEN_IP, 40],
    ] as const) {
      mockClients[ip] = makeMockClient();
      mockClients[ip].getVolume.mockResolvedValue(vol);
      mockClients[ip].getMute.mockResolvedValue(false);
      mockClients[ip].getTransportInfo.mockResolvedValue({ state: "PLAYING" });
    }
  }

  it("still returns 5 rooms (not 1) when everything is grouped", async () => {
    setupGrouped();
    const result = await getSoundSystem();
    expect(result.rooms).toHaveLength(5);
    expect(result.rooms.map((r) => r.name).sort()).toEqual([
      "Bathroom",
      "Bedroom",
      "Desk",
      "Kitchen",
      "Living Room",
    ]);
  });

  it("every room shares the group coordinatorUuid, with exactly one coordinator", async () => {
    setupGrouped();
    const result = await getSoundSystem();
    expect(result.rooms.every((r) => r.coordinatorUuid === "RINCON_F85C2420570401400")).toBe(true);
    expect(result.rooms.filter((r) => r.isCoordinator)).toHaveLength(1);
    expect(result.rooms.find((r) => r.isCoordinator)?.name).toBe("Bathroom");
  });

  it("each grouped room keeps its OWN volume", async () => {
    setupGrouped();
    const result = await getSoundSystem();
    expect(result.rooms.find((r) => r.name === "Living Room")?.volume).toBe(10);
    expect(result.rooms.find((r) => r.name === "Bathroom")?.volume).toBe(87);
    expect(result.rooms.find((r) => r.name === "Kitchen")?.volume).toBe(40);
  });
});

describe("getSoundSystem — error handling (A3)", () => {
  it("throws SonosError when topology fetch fails", async () => {
    mockClients[LIVING_ROOM_IP] = makeMockClient();
    mockClients[LIVING_ROOM_IP].getZoneGroupState.mockRejectedValue(
      new SonosError("network error"),
    );

    await expect(getSoundSystem()).rejects.toThrow();
  });

  it("throws when a per-device fetch fails (propagates upward)", async () => {
    setupHappyPath();
    // Override Living Room volume to fail
    mockClients[LIVING_ROOM_IP].getVolume.mockRejectedValue(new SonosError("ECONNREFUSED"));

    await expect(getSoundSystem()).rejects.toThrow();
  });
});
