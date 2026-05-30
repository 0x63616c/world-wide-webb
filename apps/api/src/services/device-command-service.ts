import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { type DeviceLightState, deviceCommands, deviceState } from "../db/schema";
import { ha } from "../integrations/homeassistant";

const DESIRED_WINDOW_MS = 5_000;

// Serialises concurrent commands to the same device; prevents race conditions
// when rapid toggles fire before a dispatch completes.
const PER_DEVICE_QUEUE = new Map<string, Promise<unknown>>();

export type DeviceAction = "setOn";

export interface DeviceCommandInput {
  id: string;
  action: DeviceAction;
  args: { on?: boolean };
}

export interface DeviceCommandResult {
  id: string;
  commandId: number;
  status: "pending" | "sent" | "confirmed" | "failed" | "timeout";
}

export async function commandDevice(input: DeviceCommandInput): Promise<DeviceCommandResult> {
  const device = await loadDevice(input.id);

  const desired = applyAction(device.kind, input.action, input.args);
  const now = new Date();
  const existingUntil = device.desiredUntilUtc ?? null;
  const newUntil = new Date(now.getTime() + DESIRED_WINDOW_MS);
  const desiredUntil = existingUntil && existingUntil > newUntil ? existingUntil : newUntil;

  await db
    .update(deviceState)
    .set({
      desiredState: desired,
      desiredAtUtc: now,
      desiredUntilUtc: desiredUntil,
    })
    .where(eq(deviceState.id, device.id));

  const inserted = await db
    .insert(deviceCommands)
    .values({
      deviceId: device.id,
      action: input.action,
      args: input.args,
      status: "pending",
      issuedAtUtc: now,
    })
    .returning({ id: deviceCommands.id });
  const commandId = inserted[0]?.id;
  if (commandId === undefined) throw new Error("Failed to record device command");

  void enqueueDispatch(device.id, async () => {
    await markSent(commandId);
    try {
      await dispatchToHa(device.domain, device.entityId, input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markFailed(commandId, msg);
    }
  });

  return { id: device.id, commandId, status: "pending" };
}

async function loadDevice(id: string) {
  const rows = await db.select().from(deviceState).where(eq(deviceState.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Device ${id} not found`);
  return row;
}

function applyAction(
  _kind: string,
  action: DeviceAction,
  args: { on?: boolean },
): DeviceLightState {
  switch (action) {
    case "setOn": {
      if (typeof args.on !== "boolean") throw new Error("setOn requires args.on (boolean)");
      return { on: args.on };
    }
    default:
      throw new Error(`Unknown device action: ${action}`);
  }
}

async function dispatchToHa(
  domain: string,
  entityId: string,
  input: DeviceCommandInput,
): Promise<void> {
  switch (input.action) {
    case "setOn": {
      const service = input.args.on ? "turn_on" : "turn_off";
      await ha.callService(domain, service, { entity_id: entityId });
      return;
    }
  }
}

async function markSent(commandId: number): Promise<void> {
  await db
    .update(deviceCommands)
    .set({ status: "sent", sentAtUtc: new Date() })
    .where(eq(deviceCommands.id, commandId));
}

async function markFailed(commandId: number, error: string): Promise<void> {
  await db
    .update(deviceCommands)
    .set({ status: "failed", error })
    .where(eq(deviceCommands.id, commandId));
}

function enqueueDispatch(deviceId: string, fn: () => Promise<void>): Promise<void> {
  const prev = PER_DEVICE_QUEUE.get(deviceId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  PER_DEVICE_QUEUE.set(
    deviceId,
    next.finally(() => {
      if (PER_DEVICE_QUEUE.get(deviceId) === next) PER_DEVICE_QUEUE.delete(deviceId);
    }),
  );
  return next;
}
