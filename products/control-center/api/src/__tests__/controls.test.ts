/**
 * Unit tests for the controls service + router.
 *
 * All network/HA calls are mocked via vi.mock , no Postgres or real HA needed.
 * The DB is also mocked since controls-service now queries deviceState.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock the HA singleton ────────────────────────────────────────────────────

const { mockIsConfigured, mockGetEntities, mockCallService } = vi.hoisted(() => ({
  mockIsConfigured: vi.fn<() => boolean>(),
  mockGetEntities: vi.fn<(domain: string) => Promise<unknown>>(),
  mockCallService: vi.fn<() => Promise<void>>(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    isConfigured: mockIsConfigured,
    getEntities: mockGetEntities,
    callService: mockCallService,
  },
}));

// ─── mock the DB ──────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbUpdate, mockDbInsert } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
}));

// ─── import after mock ────────────────────────────────────────────────────────

import {
  LampMode,
  LampModeSpeed,
  LampScene,
  MOOD_PALETTE,
  WHITE_SCENE_KELVIN,
} from "../config/lamp-scenes";
import { FIXTURE_ENTITY_IDS, LAMP_ENTITY_IDS } from "../config/lights";
import { lampMode } from "../db/schema";
import {
  ControlKey,
  FanMode,
  getControlsState,
  setLampBrightness,
  setLampMode,
  setLampScene,
  setLights,
  toggleControl,
} from "../services/controls-service";
import { router } from "../trpc/init";
import { controlsRouter } from "../trpc/routers/controls";

// ─── helpers ──────────────────────────────────────────────────────────────────
//
// Lamp/light state is now desired-authoritative (www-7d5b.2.4): getControlsState
// reads it from device_state rows (lampRow/fixtureRow below), NOT from live HA
// entities. HA is read only for the fan (climate fan_mode), so the only HA-entity
// builders still needed are the fan/climate ones.

function makeFan(id: string, state: "on" | "off", percentage?: number) {
  return {
    entity_id: `fan.${id}`,
    state,
    attributes: { friendly_name: id, ...(percentage !== undefined ? { percentage } : {}) },
    last_updated: new Date().toISOString(),
  };
}

// Build a chainable query mock. Every builder method returns a chain
// that ultimately resolves to `rows` when awaited.
class SelectChain {
  private readonly rows: unknown[];
  constructor(rows: unknown[]) {
    this.rows = rows;
  }
  from(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  [Symbol.toStringTag] = "SelectChain";
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(
    onFulfilled: (v: unknown[]) => R | PromiseLike<R>,
    onRejected?: (e: unknown) => R | PromiseLike<R>,
  ): Promise<R> {
    return Promise.resolve(this.rows).then(onFulfilled, onRejected);
  }
  catch<R>(onRejected: (e: unknown) => R | PromiseLike<R>): Promise<unknown[] | R> {
    return Promise.resolve(this.rows).catch(onRejected);
  }
  finally(onFinally?: (() => void) | null): Promise<unknown[]> {
    return Promise.resolve(this.rows).finally(onFinally ?? undefined);
  }
}

function makeSelectChain(rows: unknown[]): SelectChain {
  return new SelectChain(rows);
}

/**
 * Drive db.select() so the lamp_mode singleton read (a PROJECTED select ,
 * db.select({ mode }) , which controls-service uses) resolves to a row with the
 * given mode, while every other (unprojected) select resolves to `deviceRows`.
 * Lets a test set the persistent lamp mode without colliding with the device-row
 * read in the same getControlsState call.
 */
function mockSelectWithMode(deviceRows: unknown[], mode: string | null): void {
  mockDbSelect.mockImplementation((projection?: unknown) => {
    if (projection !== undefined) {
      return makeSelectChain(mode === null ? [] : [{ mode }]);
    }
    return makeSelectChain(deviceRows);
  });
}

// Chainable insert mock for db.insert().values().onConflictDoUpdate().
// `valuesSpy` (when provided) records each .values() payload so a test can assert
// the desired-state written per entity (the mutations no longer call HA, so the
// desired write is the only observable side-effect , www-unxz.1).
class InsertChain {
  private readonly valuesSpy?: (payload: unknown) => void;
  constructor(valuesSpy?: (payload: unknown) => void) {
    this.valuesSpy = valuesSpy;
  }
  values(payload?: unknown): this {
    this.valuesSpy?.(payload);
    return this;
  }
  returning(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  onConflictDoUpdate(): Promise<void> {
    return Promise.resolve();
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(
    onFulfilled: (v: undefined) => R | PromiseLike<R>,
    onRejected?: (e: unknown) => R | PromiseLike<R>,
  ): Promise<R> {
    return Promise.resolve(undefined).then(onFulfilled, onRejected);
  }
}

function makeInsertChain(valuesSpy?: (payload: unknown) => void): InsertChain {
  return new InsertChain(valuesSpy);
}

// Captured `.values()` payload shape for a device_state upsert (the fields the
// assertions care about).
interface DesiredInsert {
  entityId?: string;
  desiredState?: { on: boolean; brightness?: number; color?: unknown };
  desiredUntilUtc?: Date;
}

/**
 * Wire db.insert() to capture every device_state upsert's `.values()` payload,
 * keyed by entityId. lamp_mode upserts (no entityId) are ignored. Lets a test
 * assert the desired written per entity without HA being involved.
 */
function captureDesiredWrites(): Map<string, DesiredInsert> {
  const byEntity = new Map<string, DesiredInsert>();
  mockDbInsert.mockImplementation(() =>
    makeInsertChain((payload) => {
      const p = payload as DesiredInsert;
      if (p?.entityId) byEntity.set(p.entityId, p);
    }),
  );
  return byEntity;
}

// The shape captured from db.update().set() (the fan writes desired via update).
interface DesiredUpdate {
  desiredState?: { mode: string; fanMode?: string };
  desiredUntilUtc?: Date;
}

/**
 * Wire db.update() to capture the `.set()` payload of the last update (the fan
 * mutation writes desired on the climate row via update , www-unxz.2). Returns a
 * holder whose `.last` is the captured payload.
 */
function captureUpdates(): { last: DesiredUpdate | null } {
  const holder: { last: DesiredUpdate | null } = { last: null };
  mockDbUpdate.mockImplementation(() => ({
    set(payload: unknown) {
      holder.last = payload as DesiredUpdate;
      return { where: () => Promise.resolve() };
    },
  }));
  return holder;
}

// Make a deviceState row with typical fields. Desired-authoritative (www-7d5b.2.4):
// getControlsState reads lamp/light state from desiredState (falling back to
// reportedState when desired is null), with availability honest.
function makeDeviceRow(
  overrides: Partial<{
    id: string;
    kind: string;
    entityId: string;
    domain: string;
    label: string;
    reportedState: unknown;
    desiredState: unknown;
    desiredUntilUtc: Date | null;
    available: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? "dev-1",
    kind: overrides.kind ?? "light",
    entityId: overrides.entityId ?? "light.lamp",
    domain: overrides.domain ?? "light",
    label: overrides.label ?? "Lamp",
    reportedState: overrides.reportedState ?? { on: false },
    desiredState: overrides.desiredState ?? null,
    desiredUntilUtc: overrides.desiredUntilUtc ?? null,
    desiredAtUtc: null,
    reportedAtUtc: null,
    reportedChangedAtUtc: null,
    available: overrides.available ?? true,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

// A lamp device row whose DESIRED state is the source of truth (www-7d5b.2.4).
// brightness is HA raw 0..255 to match how the enforcer stores it.
function lampRow(
  id: string,
  entityId: string,
  desired: { on: boolean; brightness?: number; color?: unknown } | null,
  available = true,
) {
  // Default reported = desired so the row reads as converged (pending:false)
  // unless a test deliberately diverges them.
  return makeDeviceRow({
    id,
    entityId,
    kind: "light",
    domain: "light",
    desiredState: desired,
    reportedState: desired,
    available,
  });
}

// A fixture (switch) device row, desired-authoritative.
function fixtureRow(id: string, entityId: string, on: boolean, available = true) {
  return makeDeviceRow({
    id,
    entityId,
    kind: "switch",
    domain: "switch",
    desiredState: { on },
    reportedState: { on },
    available,
  });
}

// The climate thermostat device_state row (www-unxz.2). The fan is read from this
// row's desired.fanMode, desired-authoritative like the lamps. `id` must be the
// CLIMATE_DEVICE_ID the service reads by ("climate-thermostat").
function climateFanRow(
  desiredFanMode: string | null,
  reportedFanMode: string | null,
  available = true,
  mode = "cool",
) {
  return makeDeviceRow({
    id: "climate-thermostat",
    entityId: "climate.home",
    kind: "climate",
    domain: "climate",
    desiredState: desiredFanMode === null ? { mode } : { mode, fanMode: desiredFanMode },
    reportedState: reportedFanMode === null ? { mode } : { mode, fanMode: reportedFanMode },
    available,
  });
}

// Build a minimal caller context for the tRPC router.
function buildCaller() {
  const appRouter = router({ controls: controlsRouter });
  // @ts-expect-error , db not needed by controls procedures (they use global db)
  return appRouter.createCaller({ db: null });
}

// ─── service tests ────────────────────────────────────────────────────────────

describe("getControlsState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Lamp/light state is desired-authoritative , HA is read only for the fan
    // (climate). Default: no climate entities.
    mockGetEntities.mockResolvedValue([]);
  });

  it("throws when HA is not configured (www-355t.30: THROW-on-unavailable)", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(getControlsState()).rejects.toThrow("Home Assistant is not configured");
  });

  it("degrades to all-off when the DB is unreachable (desired-authoritative read swallows)", async () => {
    // www-unxz.2: getControlsState makes NO live HA read now (lamps/lights/fan are
    // all desired-authoritative). A DB outage yields no rows → every control reads
    // off/unavailable, matching the established lamp contract (www-7d5b.2.4).
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockImplementation(() => {
      throw new Error("DB unreachable");
    });

    const state = await getControlsState();

    expect(state.lamps.on).toBe(false);
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
    expect(mockGetEntities).not.toHaveBeenCalled();
  });

  it("derives lamp state from DESIRED device rows (source of truth)", async () => {
    mockIsConfigured.mockReturnValue(true);

    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: true }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: true }),
      fixtureRow("fix-1", "switch.overhead_lights", false),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true);
    expect(state.lamps.count).toBe(2);
    expect(state.lights.on).toBe(false);
    expect(state.lamps.pending).toBe(false);
  });

  it("reports lamp brightness as the rounded avg pct of on-lamps from desired", async () => {
    mockIsConfigured.mockReturnValue(true);
    // desired brightness is HA raw 0..255: 255 → 100%, 128 → 50%; off lamp excluded.
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: true, brightness: 255 }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: true, brightness: 128 }),
      lampRow("lamp-3", "light.kitchen_lamp", { on: false, brightness: 64 }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true);
    expect(state.lamps.count).toBe(2);
    expect(state.lamps.brightness).toBe(75);
  });

  it("www-91bl: keeps last-known desired brightness when all lamps are off (bar grays, keeps level)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // Both lamps OFF but desired brightness persists (255→100%, 128→50%): the bar
    // must show the level it will resume to (avg 75%), NOT drop to 0%.
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: false, brightness: 255 }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: false, brightness: 128 }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(false);
    expect(state.lamps.brightness).toBe(75);
  });

  it("www-91bl: brightness is 0 only when no lamp has any known level", async () => {
    mockIsConfigured.mockReturnValue(true);
    // Lamps off with NO brightness ever set → truly unknown → 0 (empty bar is correct).
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: false }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: false }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(false);
    expect(state.lamps.brightness).toBe(0);
  });

  it("never paints an unreachable lamp 'on' even when desired says on (honest availability)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: true }, /* available */ false),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    // Desired is on, but the lamp is unreachable → not counted on (tile shimmers).
    expect(state.lamps.on).toBe(false);
    expect(state.lamps.count).toBe(0);
  });

  it("lamps never report pending even when desired has not converged (www-uq58)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const row = makeDeviceRow({
      id: "lamp-1",
      entityId: "light.living_room_globe",
      kind: "light",
      domain: "light",
      reportedState: { on: false },
      desiredState: { on: true },
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([row]));

    const state = await getControlsState();

    // Effective (desired) is on; reported still off , but lamps are
    // desired-authoritative and never surface a pending cue (www-uq58).
    expect(state.lamps.on).toBe(true);
    expect(state.lamps.pending).toBe(false);
  });

  it("pending:false once reported converges with desired", async () => {
    mockIsConfigured.mockReturnValue(true);
    const row = makeDeviceRow({
      id: "lamp-1",
      entityId: "light.living_room_globe",
      kind: "light",
      domain: "light",
      reportedState: { on: true },
      desiredState: { on: true },
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([row]));

    const state = await getControlsState();

    expect(state.lamps.pending).toBe(false);
  });

  it("reports fan on from the climate row's desired fan_mode (www-unxz.2), NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("on", "on")]));

    const state = await getControlsState();

    expect(state.fan.on).toBe(true);
    expect(state.fan.sub).toBe("On");
    expect(state.fan.pending).toBe(false);
    expect(mockGetEntities).not.toHaveBeenCalled();
  });

  it("labels fan 'Auto' when fan_mode is auto AND the AC is running (www-pu4m)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // mode cool (running) + fanMode auto → "auto" is meaningful (fan follows demand).
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("auto", "auto", true, "cool")]));

    const state = await getControlsState();

    expect(state.fan.on).toBe(false);
    expect(state.fan.sub).toBe("Auto");
  });

  it("labels fan 'Off' when fan_mode is auto AND the AC mode is off (www-pu4m)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // AC off → an "auto" fan is doing nothing, so surface it honestly as Off.
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("auto", "auto", true, "off")]));

    const state = await getControlsState();

    expect(state.fan.on).toBe(false);
    expect(state.fan.sub).toBe("Off");
  });

  it("fan pending:true while desired fan_mode has not converged with reported", async () => {
    mockIsConfigured.mockReturnValue(true);
    // Desired on, reported still auto → the fan command is in-flight.
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("on", "auto")]));

    const state = await getControlsState();

    expect(state.fan.on).toBe(true);
    expect(state.fan.pending).toBe(true);
  });

  it("www-azw: switch-domain fixtures are visible as 'lights' (from desired)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([fixtureRow("fix-1", "switch.overhead_lights", true)]),
    );

    const state = await getControlsState();

    expect(state.lights.on).toBe(true);
  });

  // ─── lights: per-fixture (kitchen | overhead) derivation for the mode cycle ───

  it("lights derive both fixtures off → kitchen:false, overhead:false, on:false", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state.lights.kitchen).toBe(false);
    expect(state.lights.overhead).toBe(false);
    expect(state.lights.on).toBe(false);
  });

  it("lights derive kitchen-only when just the under-cabinet fixture is on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        fixtureRow("fix-kitchen", "switch.under_cabinet", true),
        fixtureRow("fix-overhead", "switch.overhead_lights", false),
      ]),
    );

    const state = await getControlsState();

    expect(state.lights.kitchen).toBe(true);
    expect(state.lights.overhead).toBe(false);
    expect(state.lights.on).toBe(true);
  });

  it("lights derive overhead-only when just the overhead fixture is on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        fixtureRow("fix-kitchen", "switch.under_cabinet", false),
        fixtureRow("fix-overhead", "switch.overhead_lights", true),
      ]),
    );

    const state = await getControlsState();

    expect(state.lights.kitchen).toBe(false);
    expect(state.lights.overhead).toBe(true);
    expect(state.lights.on).toBe(true);
  });

  it("lights derive both-on when both fixtures are on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        fixtureRow("fix-kitchen", "switch.under_cabinet", true),
        fixtureRow("fix-overhead", "switch.overhead_lights", true),
      ]),
    );

    const state = await getControlsState();

    expect(state.lights.kitchen).toBe(true);
    expect(state.lights.overhead).toBe(true);
    expect(state.lights.on).toBe(true);
  });

  it("never paints an unreachable fixture on (honest availability) , kitchen reads off", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        fixtureRow("fix-kitchen", "switch.under_cabinet", true, /* available */ false),
      ]),
    );

    const state = await getControlsState();

    // Desired on, but unreachable → not painted on (mode stays OFF for that side).
    expect(state.lights.kitchen).toBe(false);
    expect(state.lights.on).toBe(false);
  });

  it("www-azw: Hue lamps classified as lamps, not fixtures", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([lampRow("lamp-1", "light.living_room_globe", { on: true })]),
    );

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true);
    expect(state.lamps.count).toBe(1);
    expect(state.lights.on).toBe(false);
  });

  it("reports all off when no device rows exist", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(false);
    expect(state.lamps.count).toBe(0);
    expect(state.lamps.sub).toBe("Off");
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
  });

  // ─── activeScene derivation (from desired colors) ──────────────────────────

  it("activeScene='blue' when every on-lamp's desired color is BLUE_RGB", async () => {
    mockIsConfigured.mockReturnValue(true);
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: true, color: { rgb: [0, 0, 255] } }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: true, color: { rgb: [0, 0, 255] } }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBe(LampScene.Blue);
  });

  it("activeScene='white' when on-lamps' desired color is WHITE_SCENE_KELVIN", async () => {
    mockIsConfigured.mockReturnValue(true);
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", {
        on: true,
        color: { kelvin: WHITE_SCENE_KELVIN },
      }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBe(LampScene.White);
  });

  it("activeScene=null when on-lamps disagree on non-palette colors", async () => {
    mockIsConfigured.mockReturnValue(true);
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", { on: true, color: { rgb: [255, 0, 0] } }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: true, color: { rgb: [0, 0, 255] } }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBeNull();
  });

  it("activeScene='mood' when every on-lamp shows a MOOD_PALETTE color (varied wash, www-vhht)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const rows = [
      lampRow("lamp-1", "light.living_room_globe", {
        on: true,
        color: { rgb: [...MOOD_PALETTE[0]] },
      }),
      lampRow("lamp-2", "light.bed_lamp_left", { on: true, color: { rgb: [...MOOD_PALETTE[3]] } }),
      lampRow("lamp-3", "light.bed_lamp_right", { on: true, color: { rgb: [...MOOD_PALETTE[5]] } }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(rows));

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBe(LampScene.Mood);
  });

  it("activeScene=null when lamps are off", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(
      makeSelectChain([lampRow("lamp-1", "light.living_room_globe", { on: false })]),
    );

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBeNull();
  });
});

// ─── toggleControl tests ──────────────────────────────────────────────────────

describe("toggleControl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(toggleControl(ControlKey.Lamps, true)).rejects.toThrow(
      "Home Assistant is not configured",
    );
  });

  it("writes desired (on) + command window for every lamp, with NO HA call (www-unxz.1)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    const writes = captureDesiredWrites();

    await toggleControl(ControlKey.Lamps, true);

    // Desired is written (sticky source of truth) for every lamp , the enforcer
    // actuates HA, so the hot path makes NO ha.callService.
    expect(mockDbInsert).toHaveBeenCalledTimes(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of LAMP_ENTITY_IDS) {
      const w = writes.get(entityId);
      expect(w?.desiredState).toMatchObject({ on: true });
      // The command window is stamped so the enforcer pushes regardless of policy.
      expect(w?.desiredUntilUtc).toBeInstanceOf(Date);
    }
  });

  it("routes a binary Lights toggle through setLights (both fixtures follow `on`), NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    const writes = captureDesiredWrites();

    await toggleControl(ControlKey.Lights, false);

    // The Lights control is now a mode cycle; a stray binary toggle still drives
    // both fixtures via setLights. Both fixtures written off, no HA call.
    expect(mockDbInsert).toHaveBeenCalledTimes(FIXTURE_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of FIXTURE_ENTITY_IDS) {
      expect(writes.get(entityId)?.desiredState).toMatchObject({ on: false });
    }
  });

  it("toggling a lamp ON preserves its existing desired color (scene survives a toggle)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // One lamp already has a blue desired color; turning lamps on must keep it.
    mockDbSelect.mockReturnValue(
      makeSelectChain([
        lampRow("lamp-1", "light.living_room_globe", { on: false, color: { rgb: [0, 0, 255] } }),
      ]),
    );
    const writes = captureDesiredWrites();

    await toggleControl(ControlKey.Lamps, true);

    // The desired written for the globe carries its preserved color , no HA call.
    expect(mockCallService).not.toHaveBeenCalled();
    expect(writes.get("light.living_room_globe")?.desiredState).toMatchObject({
      on: true,
      color: { rgb: [0, 0, 255] },
    });
  });

  it("toggling the fan ON writes desired.fanMode='on' (+window) on the climate row, NO HA call (www-unxz.2)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // The enforcer has seeded the climate row; the fan write updates its desired.
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("auto", "auto")]));
    const updates = captureUpdates();

    await toggleControl(ControlKey.Fan, true);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(updates.last?.desiredState).toMatchObject({ fanMode: FanMode.On });
    // The mode is preserved (not clobbered) and a command window is stamped.
    expect(updates.last?.desiredState?.mode).toBe("cool");
    expect(updates.last?.desiredUntilUtc).toBeInstanceOf(Date);
  });

  it("toggling the fan OFF writes desired.fanMode='auto', NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("on", "on")]));
    const updates = captureUpdates();

    await toggleControl(ControlKey.Fan, false);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(updates.last?.desiredState).toMatchObject({ fanMode: FanMode.Auto });
  });

  it("the fan is a climate fan_mode written to desired, never a device command or HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("auto", "auto")]));
    captureUpdates();

    await expect(toggleControl(ControlKey.Fan, true)).resolves.toBeDefined();
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("www-hu8p: clears party mode when turning lamps OFF (party must not resurrect on next on)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl(ControlKey.Lamps, false);

    expect(mockDbInsert).toHaveBeenCalledWith(lampMode);
  });

  it("www-hu8p: does NOT clear party mode when turning lamps ON (party is durable)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl(ControlKey.Lamps, true);

    expect(mockDbInsert).not.toHaveBeenCalledWith(lampMode);
  });

  it("propagates a desired-write failure instead of swallowing it (www-unxz.1)", async () => {
    // The desired write is the mutation's only effect , a swallowed DB error would
    // be fabricated success. The store throws; toggleControl lets it propagate.
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockImplementation(() => {
      throw new Error("DB unreachable");
    });

    await expect(toggleControl(ControlKey.Lamps, true)).rejects.toThrow("DB unreachable");
  });

  it("toggling the fan throws when the climate row is not yet seeded (parity with climate mutations)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(toggleControl(ControlKey.Fan, true)).rejects.toThrow("no climate state");
  });
});

// ─── setLights (the Lights 4-state mode cycle backing mutation) ────────────────

describe("setLights", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(setLights(true, false)).rejects.toThrow("Home Assistant is not configured");
  });

  it("writes each fixture's desired independently (kitchen on, overhead off), NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLights(true, false);

    expect(mockDbInsert).toHaveBeenCalledTimes(2);
    expect(mockCallService).not.toHaveBeenCalled();
    // kitchen = under-cabinet fixture; overhead = overhead switch.
    expect(writes.get("switch.under_cabinet")?.desiredState).toMatchObject({ on: true });
    expect(writes.get("switch.overhead_lights")?.desiredState).toMatchObject({ on: false });
    // Each write stamps a command window so the enforcer pushes regardless of policy.
    expect(writes.get("switch.under_cabinet")?.desiredUntilUtc).toBeInstanceOf(Date);
  });

  it("writes overhead on, kitchen off for the overhead-only mode", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLights(false, true);

    expect(writes.get("switch.under_cabinet")?.desiredState).toMatchObject({ on: false });
    expect(writes.get("switch.overhead_lights")?.desiredState).toMatchObject({ on: true });
  });

  it("writes both fixtures on for the both-on mode", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLights(true, true);

    expect(writes.get("switch.under_cabinet")?.desiredState).toMatchObject({ on: true });
    expect(writes.get("switch.overhead_lights")?.desiredState).toMatchObject({ on: true });
  });

  it("writes both fixtures off for the off mode", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLights(false, false);

    expect(writes.get("switch.under_cabinet")?.desiredState).toMatchObject({ on: false });
    expect(writes.get("switch.overhead_lights")?.desiredState).toMatchObject({ on: false });
  });

  it("returns the merged controls state after dispatching", async () => {
    mockIsConfigured.mockReturnValue(true);

    const state = await setLights(true, false);

    expect(state).toHaveProperty("lights");
    expect(state.lights).toHaveProperty("kitchen");
    expect(state.lights).toHaveProperty("overhead");
  });

  it("propagates a desired-write failure instead of swallowing it", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockDbInsert.mockImplementation(() => {
      throw new Error("DB unreachable");
    });

    await expect(setLights(true, true)).rejects.toThrow("DB unreachable");
  });
});

describe("controlsRouter.setLights", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("returns merged controls state via tRPC caller", async () => {
    mockIsConfigured.mockReturnValue(true);

    const caller = buildCaller();
    const result = await caller.controls.setLights({ kitchen: true, overhead: false });

    expect(result).toHaveProperty("lights");
    expect(result.lights).toHaveProperty("kitchen");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const caller = buildCaller();
    await expect(
      caller.controls.setLights({ kitchen: true, overhead: true }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

// ─── router (tRPC caller) tests ───────────────────────────────────────────────

describe("controlsRouter.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws SERVICE_UNAVAILABLE via tRPC caller when HA is not configured (www-355t.30)", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    await expect(caller.controls.list({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("returns controls state via tRPC caller when HA is configured", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(
      makeSelectChain([lampRow("lamp-1", "light.living_room_globe", { on: true })]),
    );

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result.lamps.on).toBe(true);
    expect(result.lamps.pending).toBe(false);
  });

  it("lamps stay pending:false even when desired has not converged (www-uq58)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    const row = makeDeviceRow({
      id: "lamp-1",
      entityId: "light.living_room_globe",
      kind: "light",
      domain: "light",
      reportedState: { on: false },
      desiredState: { on: true },
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([row]));

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result.lamps.pending).toBe(false);
  });
});

describe("controlsRouter.toggle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
  });

  it("returns merged state (not just { success: true }) including pending:true", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("ceiling", "off")]);
    // The enforcer has seeded the climate row, so the fan write can update it.
    mockDbSelect.mockReturnValue(makeSelectChain([climateFanRow("auto", "auto")]));
    mockDbUpdate.mockImplementation(() => ({
      set: () => ({ where: () => Promise.resolve() }),
    }));

    const caller = buildCaller();
    const result = await caller.controls.toggle({ key: ControlKey.Fan, on: true });

    // Result should be the merged controls state shape, not { success: true }
    expect(result).toHaveProperty("fan");
    expect(result?.fan).toHaveProperty("pending");
    expect(result?.fan).toHaveProperty("on");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    await expect(caller.controls.toggle({ key: ControlKey.Lamps, on: true })).rejects.toMatchObject(
      {
        code: "SERVICE_UNAVAILABLE",
      },
    );
  });
});

// ─── setLampScene tests ───────────────────────────────────────────────────────

describe("setLampScene", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(setLampScene(LampScene.White)).rejects.toThrow("Home Assistant is not configured");
  });

  it("writes a uniform white kelvin desired on every lamp, NO HA call (www-unxz.1)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampScene(LampScene.White);

    expect(writes.size).toBe(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of LAMP_ENTITY_IDS) {
      const desired = writes.get(entityId)?.desiredState as
        | { on: boolean; color?: { kelvin?: number } }
        | undefined;
      expect(desired?.on).toBe(true);
      expect(typeof desired?.color?.kelvin).toBe("number");
    }
  });

  it("writes a uniform red rgb desired on every lamp, NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampScene(LampScene.Red);

    expect(writes.size).toBe(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of LAMP_ENTITY_IDS) {
      expect(writes.get(entityId)?.desiredState).toMatchObject({
        on: true,
        color: { rgb: [255, 0, 0] },
      });
    }
  });

  it("writes a uniform blue rgb desired on every lamp, NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampScene(LampScene.Blue);

    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of LAMP_ENTITY_IDS) {
      expect(writes.get(entityId)?.desiredState).toMatchObject({
        on: true,
        color: { rgb: [0, 0, 255] },
      });
    }
  });

  it("mood: writes a DIFFERENT rgb desired across lamps (varied wash), NO HA call", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampScene(LampScene.Mood);

    expect(writes.size).toBe(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();

    // Collect the desired rgb keyed by entity_id.
    const rgbByEntity = new Map<string, string>();
    for (const entityId of LAMP_ENTITY_IDS) {
      const desired = writes.get(entityId)?.desiredState as
        | { color?: { rgb?: number[] } }
        | undefined;
      expect(desired?.color?.rgb).toBeDefined();
      rgbByEntity.set(entityId, JSON.stringify(desired?.color?.rgb));
    }

    // Every lamp gets a DISTINCT color , no repeats across the room.
    const distinct = new Set(rgbByEntity.values());
    expect(distinct.size).toBe(LAMP_ENTITY_IDS.length);

    // Each color must come from the curated palette.
    const paletteSet = new Set(MOOD_PALETTE.map((c) => JSON.stringify(c)));
    for (const rgb of rgbByEntity.values()) {
      expect(paletteSet.has(rgb)).toBe(true);
    }
  });

  it("returns the merged controls state after dispatching", async () => {
    mockIsConfigured.mockReturnValue(true);

    const state = await setLampScene(LampScene.White);

    expect(state).toHaveProperty("lamps");
    expect(state).toHaveProperty("lights");
    expect(state).toHaveProperty("fan");
  });

  it("www-hu8p: clears any active party mode so the worker stops overwriting the manual scene", async () => {
    mockIsConfigured.mockReturnValue(true);

    await setLampScene(LampScene.Red);

    // The lamp_mode singleton is upserted (to 'none') so party yields the color.
    expect(mockDbInsert).toHaveBeenCalledWith(lampMode);
  });
});

// ─── setLampBrightness tests ──────────────────────────────────────────────────

describe("setLampBrightness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(setLampBrightness(50)).rejects.toThrow("Home Assistant is not configured");
  });

  it("writes raw brightness (0..255) desired on every lamp, NO HA call (www-unxz.1)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    // 60% → round(0.6 * 255) = 153. Desired stores HA raw, matching what the
    // enforcer re-asserts on drift.
    await setLampBrightness(60);

    expect(mockDbInsert).toHaveBeenCalledTimes(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
    for (const entityId of LAMP_ENTITY_IDS) {
      expect(writes.get(entityId)?.desiredState).toMatchObject({ on: true, brightness: 153 });
    }
  });

  it("clamps brightness above 100 down to 100 (raw 255)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampBrightness(150);

    expect(writes.get(LAMP_ENTITY_IDS[0])?.desiredState).toMatchObject({ brightness: 255 });
  });

  it("clamps negative brightness up to 0 (raw 0)", async () => {
    mockIsConfigured.mockReturnValue(true);
    const writes = captureDesiredWrites();

    await setLampBrightness(-20);

    expect(writes.get(LAMP_ENTITY_IDS[0])?.desiredState).toMatchObject({ brightness: 0 });
  });

  it("returns the merged controls state after dispatching", async () => {
    mockIsConfigured.mockReturnValue(true);

    const state = await setLampBrightness(75);

    expect(state).toHaveProperty("lamps");
  });

  it("www-hu8p: does NOT clear party mode (dimming is allowed during party)", async () => {
    mockIsConfigured.mockReturnValue(true);

    await setLampBrightness(50);

    expect(mockDbInsert).not.toHaveBeenCalledWith(lampMode);
  });
});

// ─── router: setLampScene / setLampBrightness ─────────────────────────────────

describe("controlsRouter.setLampScene", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("returns merged controls state via tRPC caller", async () => {
    mockIsConfigured.mockReturnValue(true);

    const caller = buildCaller();
    const result = await caller.controls.setLampScene({ scene: "mood" });

    expect(result).toHaveProperty("lamps");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const caller = buildCaller();
    await expect(caller.controls.setLampScene({ scene: "white" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

describe("controlsRouter.setLampBrightness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("returns merged controls state via tRPC caller", async () => {
    mockIsConfigured.mockReturnValue(true);

    const caller = buildCaller();
    const result = await caller.controls.setLampBrightness({ pct: 40 });

    expect(result).toHaveProperty("lamps");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const caller = buildCaller();
    await expect(caller.controls.setLampBrightness({ pct: 40 })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

// ─── setLampMode + activeScene='party' (www-7d5b.3.4) ──────────────────────────

describe("setLampMode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(setLampMode(LampMode.Party)).rejects.toThrow("Home Assistant is not configured");
  });

  it("writes the lamp_mode row when starting party with a lamp on", async () => {
    mockIsConfigured.mockReturnValue(true);
    // A lamp is on (desired), so party is allowed; row is written.
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: true })],
      LampMode.Party,
    );

    await setLampMode(LampMode.Party, LampModeSpeed.Fast);

    // The singleton row is upserted (one insert) , the worker reconciles it.
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("no-ops (no row write) when starting party with NO lamps on", async () => {
    mockIsConfigured.mockReturnValue(true);
    // All lamps off → nothing to animate; the row must NOT be written.
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: false })],
      LampMode.None,
    );

    await setLampMode(LampMode.Party);

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("writes mode='none' even when no lamps are on (clearing is always allowed)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: false })],
      LampMode.None,
    );

    await setLampMode(LampMode.None);

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it("returns the merged controls state after setting the mode", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: true })],
      LampMode.Party,
    );

    const state = await setLampMode(LampMode.Party);

    expect(state).toHaveProperty("lamps");
    expect(state).toHaveProperty("lights");
    expect(state).toHaveProperty("fan");
  });
});

describe("getControlsState activeScene='party'", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetEntities.mockResolvedValue([]);
  });

  it("reports activeScene='party' when the lamp_mode row is party (overriding color)", async () => {
    mockIsConfigured.mockReturnValue(true);
    // Lamps are blue, but the party mode row overrides the color-derived scene.
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: true, color: { rgb: [0, 0, 255] } })],
      LampMode.Party,
    );

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBe(LampMode.Party);
  });

  it("falls back to the color-derived scene when the lamp_mode row is none", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: true, color: { rgb: [0, 0, 255] } })],
      LampMode.None,
    );

    const state = await getControlsState();

    expect(state.lamps.activeScene).toBe(LampScene.Blue);
  });
});

describe("controlsRouter.setLampMode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([]);
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("returns merged controls state via tRPC caller (activeScene='party')", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockSelectWithMode(
      [lampRow("lamp-1", "light.living_room_globe", { on: true })],
      LampMode.Party,
    );

    const caller = buildCaller();
    const result = await caller.controls.setLampMode({ mode: "party", speed: "medium" });

    expect(result).toHaveProperty("lamps");
    expect(result.lamps.activeScene).toBe(LampMode.Party);
  });

  it("accepts mode='none' with no speed", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockSelectWithMode([], LampMode.None);

    const caller = buildCaller();
    const result = await caller.controls.setLampMode({ mode: "none" });

    expect(result).toHaveProperty("lamps");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    await expect(caller.controls.setLampMode({ mode: "party" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
