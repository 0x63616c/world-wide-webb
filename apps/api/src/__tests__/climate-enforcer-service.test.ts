/**
 * Tests for the DB-authoritative climate enforcer (www-unxz.2).
 *
 * The reconcile decision is a PURE function (decideClimateEnforcement) so the
 * seed/push/noop/unreachable matrix is tested directly. Cycle-level tests then
 * mock db+ha to prove the decisions are executed: seeds the row on first HA sight
 * (no push), pushes desired→HA on drift, and writes real ambient/hvac_action into
 * reportedState every cycle.
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

import type { DeviceClimateState } from "../db/schema";
import {
  decideClimateEnforcement,
  runClimateEnforcerCycle,
} from "../services/climate-enforcer-service";
import type { MappedHaState } from "../services/device-state-mapping";

// ─── pure decision tests ──────────────────────────────────────────────────────

function mapped(reported: DeviceClimateState | null, available = true): MappedHaState {
  return { reported, available };
}

describe("decideClimateEnforcement (pure)", () => {
  it("seeds desired from reported when desired is null (no push), STRIPPING reported-only fields (www-dnpj)", () => {
    const reported: DeviceClimateState = { mode: "cool", target: 70, ambient: 72, action: "idle" };
    const d = decideClimateEnforcement(
      { id: "c", entityId: "climate.home", desiredState: null, desiredUntilUtc: null },
      mapped(reported),
    );
    // ambient/action are reported-only — a desired carrying them would shadow the
    // live reported values in the merge overlay and freeze the panel's room temp.
    expect(d).toEqual({ kind: "seed", desired: { mode: "cool", target: 70 } });
  });

  it("noop when desired and reported converge on the commandable fields", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "cool", target: 70 },
        desiredUntilUtc: null,
      },
      // ambient/action differ but are reported-only → still converged.
      mapped({ mode: "cool", target: 70, ambient: 99, action: "cooling" }),
    );
    expect(d).toEqual({ kind: "noop" });
  });

  // www-qktc: the thermostat has a physical interface (wall unit + ecobee app),
  // so its policy is ADOPT, like the Shelly wall switches: external drift outside
  // the app-command window is absorbed as new intent (desired := reported),
  // never fought. Only a fresh dashboard tap (inside desiredUntilUtc) pushes.
  const NOW = new Date("2026-06-10T00:00:00Z");
  const WINDOW_OPEN = new Date(NOW.getTime() + 5_000);
  const WINDOW_EXPIRED = new Date(NOW.getTime() - 5_000);

  it("adopts external mode drift outside the command window (www-qktc — last writer wins)", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "off", target: 70 },
        desiredUntilUtc: null,
      },
      mapped({ mode: "cool", target: 70, ambient: 75, action: "cooling" }),
      NOW,
    );
    // Adopted desired is the COMMANDABLE slice of reported (www-dnpj sanitize).
    expect(d).toEqual({ kind: "adopt", desired: { mode: "cool", target: 70 } });
  });

  it("adopts external setpoint drift outside the command window", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "cool", target: 68 },
        desiredUntilUtc: null,
      },
      mapped({ mode: "cool", target: 72 }),
      NOW,
    );
    expect(d).toEqual({ kind: "adopt", desired: { mode: "cool", target: 72 } });
  });

  it("adopts an external fan_mode change when the AC is idle, outside the window", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "cool", target: 70, fanMode: "on" },
        desiredUntilUtc: null,
      },
      mapped({ mode: "cool", target: 70, fanMode: "auto", action: "idle" }),
      NOW,
    );
    expect(d).toEqual({ kind: "adopt", desired: { mode: "cool", target: 70, fanMode: "auto" } });
  });

  it("adopting while conditioning keeps the prior desired fan_mode (never absorbs the AC-asserted blower)", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "cool", target: 68, fanMode: "auto" },
        desiredUntilUtc: null,
      },
      // External setpoint change to 72 while cooling; HA reports fan_mode="on"
      // only because the compressor is running (www-pu4m) — that is not intent.
      mapped({ mode: "cool", target: 72, fanMode: "on", action: "cooling" }),
      NOW,
    );
    expect(d).toEqual({
      kind: "adopt",
      desired: { mode: "cool", target: 72, fanMode: "auto" },
    });
  });

  it("pushes desired on drift INSIDE the command window (dashboard tap actuates)", () => {
    const desired: DeviceClimateState = { mode: "cool", target: 68 };
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: desired,
        desiredUntilUtc: WINDOW_OPEN,
      },
      mapped({ mode: "cool", target: 72 }),
      NOW,
    );
    expect(d).toEqual({ kind: "push", desired });
  });

  it("an EXPIRED command window adopts (the window is the only push authority)", () => {
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: { mode: "cool", target: 68 },
        desiredUntilUtc: WINDOW_EXPIRED,
      },
      mapped({ mode: "cool", target: 72 }),
      NOW,
    );
    expect(d).toEqual({ kind: "adopt", desired: { mode: "cool", target: 72 } });
  });

  // www-pu4m: while the AC is actively cooling/heating it OWNS its blower and
  // reports fan_mode="on". A desired fan_mode that disagrees is the AC asserting
  // the fan, NOT drift to fight — pushing it every cycle caused on/off/on/off.
  it("yields fan_mode while the AC is actively cooling (noop when only fan differs)", () => {
    const desired: DeviceClimateState = { mode: "cool", target: 70, fanMode: "auto" };
    const d = decideClimateEnforcement(
      { id: "c", entityId: "climate.home", desiredState: desired, desiredUntilUtc: null },
      mapped({ mode: "cool", target: 70, fanMode: "on", action: "cooling" }),
    );
    expect(d).toEqual({ kind: "noop" });
  });

  it("yields fan_mode while the AC is actively heating", () => {
    const desired: DeviceClimateState = { mode: "heat", target: 70, fanMode: "auto" };
    const d = decideClimateEnforcement(
      { id: "c", entityId: "climate.home", desiredState: desired, desiredUntilUtc: null },
      mapped({ mode: "heat", target: 70, fanMode: "on", action: "heating" }),
    );
    expect(d).toEqual({ kind: "noop" });
  });

  it("pushes a real drift while conditioning INSIDE the window, but STRIPS fan_mode (never fights the blower)", () => {
    const desired: DeviceClimateState = { mode: "cool", target: 68, fanMode: "auto" };
    const d = decideClimateEnforcement(
      {
        id: "c",
        entityId: "climate.home",
        desiredState: desired,
        desiredUntilUtc: WINDOW_OPEN,
      },
      mapped({ mode: "cool", target: 72, fanMode: "on", action: "cooling" }),
      NOW,
    );
    // fan_mode omitted from the pushed desired so set_fan_mode is never called.
    expect(d).toEqual({ kind: "push", desired: { mode: "cool", target: 68 } });
  });

  it("unreachable when HA is unavailable or reports no climate state", () => {
    expect(
      decideClimateEnforcement(
        {
          id: "c",
          entityId: "climate.home",
          desiredState: { mode: "cool" },
          desiredUntilUtc: null,
        },
        mapped(null, false),
      ),
    ).toEqual({ kind: "unreachable" });
  });
});

// ─── cycle tests ──────────────────────────────────────────────────────────────

// A thenable select chain that resolves to `rows`.
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

// Capture every db.insert().values() payload. The seed is a plain insert; the
// heartbeat insert chains .onConflictDoUpdate(). Both must resolve.
function insertCapture() {
  const payloads: unknown[] = [];
  mockDbInsert.mockReturnValue({
    values: (payload: unknown) => {
      payloads.push(payload);
      const result = Promise.resolve(undefined) as Promise<undefined> & {
        onConflictDoUpdate: () => Promise<undefined>;
      };
      result.onConflictDoUpdate = () => Promise.resolve(undefined);
      return result;
    },
  });
  return payloads;
}

function haClimate(attributes: Record<string, unknown>, state = "cool") {
  return { entity_id: "climate.home", state, attributes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCallService.mockResolvedValue(undefined);
});

describe("runClimateEnforcerCycle", () => {
  it("seeds the row on first HA sight (insert, NO push)", async () => {
    // No existing row.
    mockDbSelect.mockReturnValue(new Chain([]));
    const inserts = insertCapture();
    setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({ current_temperature: 72, temperature: 70, hvac_action: "cooling" }),
    ]);

    await runClimateEnforcerCycle();

    // The seed insert carries reported + desired (= reported) from real HA values.
    const seed = inserts.find((p) => (p as { kind?: string }).kind === "climate") as
      | { reportedState: DeviceClimateState; desiredState: DeviceClimateState }
      | undefined;
    expect(seed).toBeDefined();
    expect(seed?.reportedState).toMatchObject({ mode: "cool", target: 70, ambient: 72 });
    // Desired carries ONLY commandable fields — never the reported-only
    // ambient/action (www-dnpj: they'd freeze the panel's room temp at seed time).
    expect(seed?.desiredState).toEqual({ mode: "cool", target: 70 });
    // Seeding never actuates HA.
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("self-heals a stale desired that carries reported-only ambient/action (www-dnpj)", async () => {
    // Prod repro: desired was seeded pre-fix as a wholesale copy of reported, so
    // it still carries ambient/action. The cycle must persist a sanitized desired
    // (no manual migration) while leaving the commandable fields untouched.
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 72, fanMode: "on", ambient: 71, action: "cooling" },
      reportedState: { mode: "cool", target: 72, fanMode: "auto", ambient: 73, action: "cooling" },
      desiredUntilUtc: null,
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture();
    const set = setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({
        current_temperature: 73,
        temperature: 72,
        fan_mode: "auto",
        hvac_action: "cooling",
      }),
    ]);

    await runClimateEnforcerCycle();

    // Converged on commandable fields (fan yielded while cooling) → no actuation.
    expect(mockCallService).not.toHaveBeenCalled();
    const persisted = set.mock.calls.find(
      (c) => (c[0] as { desiredState?: unknown })?.desiredState !== undefined,
    );
    expect((persisted?.[0] as { desiredState: DeviceClimateState }).desiredState).toEqual({
      mode: "cool",
      target: 72,
      fanMode: "on",
    });
  });

  it("pushes desired→HA on drift inside the command window (set_hvac_mode + set_temperature + set_fan_mode)", async () => {
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 68, fanMode: "on" },
      reportedState: { mode: "cool", target: 72, fanMode: "auto" },
      // Fresh dashboard tap: the command window is open, so desired pushes.
      desiredUntilUtc: new Date(Date.now() + 9_000),
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture(); // heartbeat
    setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({ current_temperature: 72, temperature: 72, fan_mode: "auto" }),
    ]);

    await runClimateEnforcerCycle();

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.home",
      hvac_mode: "cool",
    });
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.home",
      temperature: 68,
    });
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_fan_mode", {
      entity_id: "climate.home",
      fan_mode: "on",
    });
  });

  it("ADOPTS an external setpoint change outside the window: no HA call, desired := reported (www-qktc)", async () => {
    // Prod repro 2026-06-10: setpoint changed on the physical ecobee (75) was
    // reverted to the dashboard's 72 within 190ms. It must persist instead.
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 72 },
      reportedState: { mode: "cool", target: 72, ambient: 77 },
      desiredUntilUtc: null,
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture();
    const set = setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({ current_temperature: 77, temperature: 75, hvac_action: "cooling" }),
    ]);

    await runClimateEnforcerCycle();

    // The wall change is absorbed, never fought.
    expect(mockCallService).not.toHaveBeenCalled();
    const persisted = set.mock.calls.find(
      (c) => (c[0] as { desiredState?: unknown })?.desiredState !== undefined,
    );
    expect((persisted?.[0] as { desiredState: DeviceClimateState }).desiredState).toEqual({
      mode: "cool",
      target: 75,
    });
  });

  it("writes FRESH reportedState (incl. real ambient/action) every cycle, no push when converged", async () => {
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 70 },
      reportedState: { mode: "cool", target: 70, ambient: 71 },
      desiredUntilUtc: null,
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture();
    const set = setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({ current_temperature: 73, temperature: 70, hvac_action: "cooling" }),
    ]);

    await runClimateEnforcerCycle();

    // Converged commandable fields → no actuation.
    expect(mockCallService).not.toHaveBeenCalled();
    // But reported is refreshed with the real ambient/action from HA.
    const persisted = set.mock.calls.find(
      (c) => (c[0] as { reportedState?: unknown })?.reportedState !== undefined,
    );
    expect((persisted?.[0] as { reportedState: DeviceClimateState }).reportedState).toMatchObject({
      mode: "cool",
      ambient: 73,
      action: "cooling",
    });
  });

  it("does NOT push fan_mode while actively cooling — regression: no on/off/on/off flicker (www-pu4m)", async () => {
    // User scenario: AC cool, ambient 75 > target 70 (actively cooling), fan
    // turned off via Controls (desired fanMode=auto). HA reports fan_mode=on
    // because the compressor is running. The enforcer must NOT re-push the fan.
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 70, fanMode: "auto" },
      reportedState: { mode: "cool", target: 70, fanMode: "on", ambient: 75, action: "cooling" },
      desiredUntilUtc: null,
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture();
    setBuilder();
    mockGetEntities.mockResolvedValue([
      haClimate({
        current_temperature: 75,
        temperature: 70,
        fan_mode: "on",
        hvac_action: "cooling",
      }),
    ]);

    await runClimateEnforcerCycle();

    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("marks unavailable when HA does not report the configured thermostat", async () => {
    const row = {
      id: "climate-thermostat",
      kind: "climate",
      entityId: "climate.home",
      domain: "climate",
      desiredState: { mode: "cool", target: 70 },
      reportedState: { mode: "cool", target: 70 },
      desiredUntilUtc: null,
      available: true,
    };
    mockDbSelect.mockReturnValue(new Chain([row]));
    insertCapture();
    const set = setBuilder();
    mockGetEntities.mockResolvedValue([]); // thermostat absent

    await runClimateEnforcerCycle();

    expect(mockCallService).not.toHaveBeenCalled();
    const availFalse = set.mock.calls.find(
      (c) => (c[0] as { available?: boolean })?.available === false,
    );
    expect(availFalse).toBeDefined();
  });
});
