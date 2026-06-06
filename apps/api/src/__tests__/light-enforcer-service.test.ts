/**
 * Tests for the DB-authoritative light enforcer (CC-7d5b.2.3).
 *
 * The reconcile decision is a PURE function (decideEnforcement) so the
 * seed/enforce/adopt/unreachable/tolerance matrix is tested directly without
 * mocking DB+HA chains. A couple of cycle-level tests then mock db+ha to prove
 * the decisions are executed (DB writes / HA calls) only on the right branches.
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

// ─── mock HA ─────────────────────────────────────────────────────────────────

const { mockGetEntities, mockCallService } = vi.hoisted(() => ({
  mockGetEntities: vi.fn(),
  mockCallService: vi.fn(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: { getEntities: mockGetEntities, callService: mockCallService },
}));

import { LightControl } from "../config/lights";
import type { DeviceLightState } from "../db/schema";
import {
  decideEnforcement,
  lightStateConverged,
  runEnforcerCycle,
} from "../services/light-enforcer-service";

// ─── tolerant convergence compare ─────────────────────────────────────────────

describe("lightStateConverged (drift tolerance)", () => {
  it("treats small HA rgb round-trip drift as converged", () => {
    // HA round-trips [0,0,255] -> [0,2,254]; within per-channel tolerance.
    expect(
      lightStateConverged(
        { on: true, color: { rgb: [0, 0, 255] } },
        { on: true, color: { rgb: [0, 2, 254] } },
      ),
    ).toBe(true);
  });

  it("flags a real rgb change as diverged", () => {
    expect(
      lightStateConverged(
        { on: true, color: { rgb: [255, 0, 0] } },
        { on: true, color: { rgb: [0, 0, 255] } },
      ),
    ).toBe(false);
  });

  it("tolerates small kelvin drift but flags a large one", () => {
    expect(
      lightStateConverged(
        { on: true, color: { kelvin: 4000 } },
        { on: true, color: { kelvin: 4100 } },
      ),
    ).toBe(true);
    expect(
      lightStateConverged(
        { on: true, color: { kelvin: 4000 } },
        { on: true, color: { kelvin: 5000 } },
      ),
    ).toBe(false);
  });

  it("tolerates small brightness drift but flags a large one", () => {
    expect(lightStateConverged({ on: true, brightness: 200 }, { on: true, brightness: 202 })).toBe(
      true,
    );
    expect(lightStateConverged({ on: true, brightness: 200 }, { on: true, brightness: 120 })).toBe(
      false,
    );
  });

  it("on/off mismatch is always diverged regardless of color/brightness", () => {
    expect(lightStateConverged({ on: true }, { on: false })).toBe(false);
  });

  it("rgb vs kelvin color modes are diverged", () => {
    expect(
      lightStateConverged(
        { on: true, color: { rgb: [255, 0, 0] } },
        { on: true, color: { kelvin: 4000 } },
      ),
    ).toBe(false);
  });
});

// ─── pure decision matrix ─────────────────────────────────────────────────────

function dev(
  overrides: Partial<{ desiredState: DeviceLightState | null; control: LightControl }> = {},
) {
  return {
    id: "living-globe",
    entityId: "light.living_room_globe",
    domain: "light",
    control: overrides.control ?? LightControl.Enforce,
    desiredState: overrides.desiredState ?? null,
  };
}

describe("decideEnforcement", () => {
  it("seeds desired from reported when desired is null (no push)", () => {
    const d = decideEnforcement(
      dev({ desiredState: null }),
      { reported: { on: true, brightness: 180 }, available: true },
      false,
    );
    expect(d.kind).toBe("seed");
    if (d.kind === "seed") expect(d.desired).toEqual({ on: true, brightness: 180 });
  });

  it("does nothing when desired and reported are converged", () => {
    const d = decideEnforcement(
      dev({ desiredState: { on: true, brightness: 200 } }),
      { reported: { on: true, brightness: 202 }, available: true },
      false,
    );
    expect(d.kind).toBe("noop");
  });

  it("enforce + drift -> push desired to HA", () => {
    const desired: DeviceLightState = { on: true, color: { rgb: [255, 0, 0] } };
    const d = decideEnforcement(
      dev({ control: LightControl.Enforce, desiredState: desired }),
      { reported: { on: true, color: { rgb: [0, 0, 255] } }, available: true },
      false,
    );
    expect(d.kind).toBe("push");
    if (d.kind === "push") expect(d.desired).toBe(desired);
  });

  it("adopt + drift -> set desired = reported (no push)", () => {
    const reported: DeviceLightState = { on: true, color: { rgb: [0, 0, 255] } };
    const d = decideEnforcement(
      dev({ control: LightControl.Adopt, desiredState: { on: true, color: { rgb: [255, 0, 0] } } }),
      { reported, available: true },
      false,
    );
    expect(d.kind).toBe("adopt");
    if (d.kind === "adopt") expect(d.desired).toEqual(reported);
  });

  it("unreachable -> mark unavailable, no push/adopt", () => {
    const d = decideEnforcement(
      dev({ control: LightControl.Enforce, desiredState: { on: true } }),
      { reported: null, available: false },
      false,
    );
    expect(d.kind).toBe("unreachable");
  });

  it("skips drift handling while a command is in flight (converging)", () => {
    const d = decideEnforcement(
      dev({
        control: LightControl.Enforce,
        desiredState: { on: true, color: { rgb: [255, 0, 0] } },
      }),
      { reported: { on: true, color: { rgb: [0, 0, 255] } }, available: true },
      true, // commandInFlight
    );
    expect(d.kind).toBe("noop");
  });

  it("does not seed an unreachable device with null desired", () => {
    const d = decideEnforcement(
      dev({ desiredState: null }),
      { reported: null, available: false },
      false,
    );
    expect(d.kind).toBe("unreachable");
  });
});

// ─── cycle integration (mocked db + ha) ────────────────────────────────────────

class Chain {
  constructor(private readonly rows: unknown[]) {}
  from() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCallService.mockResolvedValue(undefined);
  // markHeartbeat: insert().values().onConflictDoUpdate()
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }),
  });
});

describe("runEnforcerCycle", () => {
  function haEntity(entity_id: string, state: string, attributes: Record<string, unknown> = {}) {
    return { entity_id, state, attributes };
  }

  it("enforce + drift pushes to HA and writes nothing for color drift", async () => {
    // One enforce lamp whose reported rgb diverges from desired rgb.
    const managed = [
      {
        id: "living-globe",
        kind: "light",
        entityId: "light.living_room_globe",
        domain: "light",
        desiredState: { on: true, color: { rgb: [255, 0, 0] } },
        reportedState: { on: true, color: { rgb: [255, 0, 0] } },
        available: true,
      },
    ];
    // First select = managed devices; subsequent selects (in-flight check) = none.
    mockDbSelect.mockImplementation(() => new Chain(managed));
    setBuilder();
    mockGetEntities.mockImplementation((domain: string) =>
      domain === "light"
        ? Promise.resolve([haEntity("light.living_room_globe", "on", { rgb_color: [0, 0, 255] })])
        : Promise.resolve([]),
    );

    await runEnforcerCycle();

    // enforce -> light.turn_on with the desired rgb pushed.
    const pushed = mockCallService.mock.calls.find((c) => c[0] === "light" && c[1] === "turn_on");
    expect(pushed).toBeDefined();
    expect(pushed?.[2]).toMatchObject({
      entity_id: "light.living_room_globe",
      rgb_color: [255, 0, 0],
    });
  });

  it("converged device makes no HA call", async () => {
    const managed = [
      {
        id: "living-globe",
        kind: "light",
        entityId: "light.living_room_globe",
        domain: "light",
        desiredState: { on: true, color: { rgb: [0, 0, 255] } },
        reportedState: { on: true, color: { rgb: [0, 0, 255] } },
        available: true,
      },
    ];
    mockDbSelect.mockImplementation(() => new Chain(managed));
    setBuilder();
    mockGetEntities.mockImplementation((domain: string) =>
      domain === "light"
        ? Promise.resolve([haEntity("light.living_room_globe", "on", { rgb_color: [0, 1, 254] })])
        : Promise.resolve([]),
    );

    await runEnforcerCycle();

    const pushed = mockCallService.mock.calls.find(
      (c) => c[1] === "turn_on" || c[1] === "turn_off",
    );
    expect(pushed).toBeUndefined();
  });
});
