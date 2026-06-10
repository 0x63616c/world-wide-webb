/**
 * Tests for the DB-authoritative Sonos volume enforcer (www-5mek).
 *
 * Mirrors the light-enforcer pattern: the reconcile decision is a PURE function
 * (decideSpeakerEnforcement) tested directly, then cycle-level tests mock
 * db+SonosClient to prove decisions are executed (UPnP writes / DB writes) only
 * on the right branches, and the mutation path writes desired WITHOUT touching
 * the speaker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock DB ──────────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbUpdate, mockDbInsert } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: { select: mockDbSelect, update: mockDbUpdate, insert: mockDbInsert },
}));

// ─── mock SonosClient (per-IP, like sonos-sound-system tests) ─────────────────

type MockClient = {
  getZoneGroupState: ReturnType<typeof vi.fn>;
  getVolume: ReturnType<typeof vi.fn>;
  setVolume: ReturnType<typeof vi.fn>;
};

const mockClients: Record<string, MockClient> = {};
const constructedIps: string[] = [];

function makeMockClient(): MockClient {
  return {
    getZoneGroupState: vi.fn(),
    getVolume: vi.fn(),
    setVolume: vi.fn(),
  };
}

vi.mock("../integrations/sonos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/sonos")>();
  return {
    ...actual,
    SonosClient: vi.fn().mockImplementation((ip: string) => {
      constructedIps.push(ip);
      if (!mockClients[ip]) mockClients[ip] = makeMockClient();
      return mockClients[ip];
    }),
  };
});

// ─── import after mocks ───────────────────────────────────────────────────────

import type { DeviceSpeakerState } from "../db/schema";
import { TOPOLOGY_ANCHOR_IP } from "../services/sonos-sound-system-service";
import {
  decideSpeakerEnforcement,
  runSonosVolumeEnforcerCycle,
  SPEAKER_COMMAND_WINDOW_MS,
  setSpeakerDesiredVolume,
} from "../services/sonos-volume-enforcer-service";

// ─── helpers ──────────────────────────────────────────────────────────────────

const LIVING_IP = "192.168.0.193";
const DESK_IP = "192.168.0.194";

function speaker(
  overrides: Partial<{
    id: string;
    deviceIp: string;
    desiredState: DeviceSpeakerState | null;
    desiredUntilUtc: Date | null;
  }> = {},
) {
  return {
    id: "spk_192-168-0-193",
    deviceIp: LIVING_IP,
    desiredState: null,
    desiredUntilUtc: null,
    ...overrides,
  };
}

class Chain {
  constructor(private readonly rows: unknown[]) {}
  from() {
    return this;
  }
  where() {
    return this;
  }
  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  [Symbol.toStringTag] = "Chain";
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(onFulfilled: (v: unknown[]) => R | PromiseLike<R>): Promise<R> {
    return Promise.resolve(this.rows).then(onFulfilled);
  }
}

function setBuilder() {
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockDbUpdate.mockReturnValue({ set });
  return set;
}

function insertBuilder() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({
    onConflictDoUpdate,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock (await insert().values())
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
  });
  mockDbInsert.mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockClients)) delete mockClients[key];
  constructedIps.length = 0;
});

// ─── pure decision matrix ─────────────────────────────────────────────────────

describe("decideSpeakerEnforcement", () => {
  const now = new Date("2026-01-01T00:00:05Z");
  const openWindow = new Date("2026-01-01T00:00:10Z");
  const expiredWindow = new Date("2026-01-01T00:00:01Z");

  it("unreachable when the speaker could not be read", () => {
    const d = decideSpeakerEnforcement(
      speaker({ desiredState: { volume: 30 } }),
      { volume: null, available: false },
      now,
    );
    expect(d.kind).toBe("unreachable");
  });

  it("seeds desired from reported when desired is null (no push)", () => {
    const d = decideSpeakerEnforcement(speaker(), { volume: 25, available: true }, now);
    expect(d).toEqual({ kind: "seed", desired: { volume: 25 } });
  });

  it("noop when desired matches reported exactly", () => {
    const d = decideSpeakerEnforcement(
      speaker({ desiredState: { volume: 25 } }),
      { volume: 25, available: true },
      now,
    );
    expect(d.kind).toBe("noop");
  });

  it("pushes desired on drift INSIDE the command window (app command owns it)", () => {
    const desired: DeviceSpeakerState = { volume: 60 };
    const d = decideSpeakerEnforcement(
      speaker({ desiredState: desired, desiredUntilUtc: openWindow }),
      { volume: 25, available: true },
      now,
    );
    expect(d.kind).toBe("push");
    if (d.kind === "push") expect(d.desired).toBe(desired);
  });

  it("adopts external drift OUTSIDE the window (Sonos app changes win)", () => {
    const d = decideSpeakerEnforcement(
      speaker({ desiredState: { volume: 60 }, desiredUntilUtc: expiredWindow }),
      { volume: 25, available: true },
      now,
    );
    expect(d).toEqual({ kind: "adopt", desired: { volume: 25 } });
  });

  it("adopts external drift when no window was ever set", () => {
    const d = decideSpeakerEnforcement(
      speaker({ desiredState: { volume: 60 }, desiredUntilUtc: null }),
      { volume: 25, available: true },
      now,
    );
    expect(d).toEqual({ kind: "adopt", desired: { volume: 25 } });
  });
});

// ─── mutation path: accept straight away, never touch the speaker ─────────────

describe("setSpeakerDesiredVolume", () => {
  it("upserts desiredState + a command window and makes NO SonosClient call", async () => {
    const { values, onConflictDoUpdate } = insertBuilder();
    const before = Date.now();

    await setSpeakerDesiredVolume({ deviceIp: LIVING_IP, volume: 42 });

    expect(constructedIps).toEqual([]);
    expect(values).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      kind: "speaker",
      entityId: LIVING_IP,
      desiredState: { volume: 42 },
    });
    const until = (inserted.desiredUntilUtc as Date).getTime();
    expect(until).toBeGreaterThanOrEqual(before + SPEAKER_COMMAND_WINDOW_MS);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> };
    expect(conflict.set).toMatchObject({ desiredState: { volume: 42 } });
  });
});

// ─── cycle integration (mocked db + SonosClient) ──────────────────────────────

// Get-or-create: LIVING_IP IS the topology anchor, so tests must never replace
// an existing mock client (that would clobber getZoneGroupState).
function client(ip: string): MockClient {
  if (!mockClients[ip]) mockClients[ip] = makeMockClient();
  return mockClients[ip];
}

function topology(members: { ip: string; uuid: string; zoneName: string }[]) {
  client(TOPOLOGY_ANCHOR_IP).getZoneGroupState.mockResolvedValue([
    {
      coordinatorUuid: members[0].uuid,
      members,
    },
  ]);
}

function speakerRow(
  overrides: Partial<{
    id: string;
    entityId: string;
    desiredState: DeviceSpeakerState | null;
    desiredUntilUtc: Date | null;
  }> = {},
) {
  return {
    id: "spk_192-168-0-193",
    kind: "speaker",
    entityId: LIVING_IP,
    domain: "sonos",
    label: "Living Room",
    desiredState: null,
    desiredUntilUtc: null,
    reportedState: null,
    available: true,
    ...overrides,
  };
}

describe("runSonosVolumeEnforcerCycle", () => {
  it("pushes desired volume to the speaker on drift inside the window", async () => {
    topology([{ ip: LIVING_IP, uuid: "RINCON_LIVING", zoneName: "Living Room" }]);
    client(LIVING_IP).getVolume.mockResolvedValue(20);
    const row = speakerRow({
      desiredState: { volume: 55 },
      desiredUntilUtc: new Date(Date.now() + 9_000),
    });
    mockDbSelect.mockImplementation(() => new Chain([row]));
    setBuilder();
    insertBuilder();

    await runSonosVolumeEnforcerCycle();

    expect(client(LIVING_IP).setVolume).toHaveBeenCalledWith(55);
  });

  it("adopts external drift outside the window: writes desired=reported, no UPnP write", async () => {
    topology([{ ip: LIVING_IP, uuid: "RINCON_LIVING", zoneName: "Living Room" }]);
    client(LIVING_IP).getVolume.mockResolvedValue(20);
    const row = speakerRow({ desiredState: { volume: 55 }, desiredUntilUtc: null });
    mockDbSelect.mockImplementation(() => new Chain([row]));
    const set = setBuilder();
    insertBuilder();

    await runSonosVolumeEnforcerCycle();

    expect(client(LIVING_IP).setVolume).not.toHaveBeenCalled();
    const adopted = set.mock.calls.find(
      (c) => (c[0] as { desiredState?: unknown })?.desiredState !== undefined,
    );
    expect(adopted).toBeDefined();
    expect((adopted?.[0] as { desiredState: unknown }).desiredState).toEqual({ volume: 20 });
  });

  it("seeds a row for a first-seen player (desired = reported, no push)", async () => {
    topology([{ ip: DESK_IP, uuid: "RINCON_DESK", zoneName: "Desk" }]);
    client(DESK_IP).getVolume.mockResolvedValue(33);
    mockDbSelect.mockImplementation(() => new Chain([]));
    setBuilder();
    const { values } = insertBuilder();

    await runSonosVolumeEnforcerCycle();

    expect(client(DESK_IP).setVolume).not.toHaveBeenCalled();
    const seeded = values.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((v) => v.kind === "speaker");
    expect(seeded).toBeDefined();
    expect(seeded).toMatchObject({
      entityId: DESK_IP,
      label: "Desk",
      desiredState: { volume: 33 },
      reportedState: { volume: 33 },
      available: true,
    });
  });

  it("marks a speaker unavailable when its volume read fails, leaving desired intact", async () => {
    topology([{ ip: LIVING_IP, uuid: "RINCON_LIVING", zoneName: "Living Room" }]);
    client(LIVING_IP).getVolume.mockRejectedValue(new Error("timeout"));
    const row = speakerRow({ desiredState: { volume: 55 } });
    mockDbSelect.mockImplementation(() => new Chain([row]));
    const set = setBuilder();
    insertBuilder();

    await runSonosVolumeEnforcerCycle();

    expect(client(LIVING_IP).setVolume).not.toHaveBeenCalled();
    const unavailable = set.mock.calls.find(
      (c) => (c[0] as { available?: boolean })?.available === false,
    );
    expect(unavailable).toBeDefined();
    // Desired must survive the outage — intent is never wiped by unreachability.
    expect((unavailable?.[0] as Record<string, unknown>).desiredState).toBeUndefined();
  });
});
