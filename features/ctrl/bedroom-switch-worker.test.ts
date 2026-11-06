import { createInMemoryDeviceStateStore } from "@www/core";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ deviceStateStore: {} }));
vi.mock("./config", () => ({ config: {} }));
vi.mock("./deps", () => ({ ha: {} }));

import {
  createInputWorker,
  type InputMessage,
  websocketInputSource,
} from "./bedroom-switch-worker";
import { BEDROOM_LAMPS, writeLightGroup } from "./light-command";

const id = "binary_sensor.test_input";
const settings = {
  BEDROOM_SWITCH_INPUT_ENABLED: "true",
  BEDROOM_SWITCH_INPUT_VERIFIED: "true",
  BEDROOM_SWITCH_INPUT_ENTITY_ID: id,
};
const entity = (state = "off", second = 1) => ({
  entity_id: id,
  state,
  attributes: {},
  last_changed: `2026-11-05T00:00:0${second}.000000+00:00`,
  last_updated: `2026-11-05T00:00:0${second}.000000+00:00`,
});

afterEach(() => vi.useRealTimers());

it("disabled or unverified worker never constructs transport or touches desired", async () => {
  for (const config of [
    {},
    { ...settings, BEDROOM_SWITCH_INPUT_VERIFIED: "false" },
    { ...settings, BEDROOM_SWITCH_INPUT_ENABLED: "false" },
    { ...settings, BEDROOM_SWITCH_INPUT_ENTITY_ID: "" },
  ]) {
    const store = createInMemoryDeviceStateStore();
    const transaction = vi.spyOn(store, "lightTransaction");
    const source = vi.fn();
    const worker = createInputWorker(config, store, source);
    await worker.run();
    await worker.stop();
    expect(source).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  }
});

it("orders queued edges, drops gap events and baselines reconnect; stops its transport", async () => {
  const store = createInMemoryDeviceStateStore();
  await store.lightTransaction((locked) =>
    writeLightGroup(BEDROOM_LAMPS, () => ({ on: false }), locked),
  );
  let receive = (_message: InputMessage) => {};
  let disconnect = () => {};
  const close = vi.fn(() => disconnect());
  const source = vi.fn(() => (_id: string, callback: typeof receive) => {
    receive = callback;
    return {
      close,
      done: new Promise<void>((resolve) => {
        disconnect = resolve;
      }),
    };
  });
  const worker = createInputWorker(settings, store, source);
  await worker.run();
  receive({ current: entity(), snapshot: true });
  receive({ current: entity("on", 2), previous: entity(), snapshot: false });
  receive({ current: entity("off", 3), previous: entity("on", 2), snapshot: false });
  await vi.waitFor(async () =>
    expect((await store.readInput(id))?.changed).toContain("03.000000Z"),
  );
  expect((await store.read(BEDROOM_LAMPS[0].id))?.desiredState).toMatchObject({ on: false });
  disconnect();
  await vi.waitFor(async () => {
    await worker.run();
    expect(source).toHaveBeenCalledTimes(2);
  });
  receive({ current: entity("on", 4), snapshot: true });
  await vi.waitFor(async () =>
    expect((await store.readInput(id))?.changed).toContain("04.000000Z"),
  );
  expect((await store.read(BEDROOM_LAMPS[0].id))?.desiredState).toMatchObject({ on: false });
  await worker.stop();
  expect(close).toHaveBeenCalled();
});

class Socket {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  emit(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

it("authenticates, subscribes before snapshot, ignores pre-snapshot events, and pings", async () => {
  vi.useFakeTimers();
  const socket = new Socket();
  const connect = vi.fn(() => socket as unknown as WebSocket);
  const receive = vi.fn();
  const connection = websocketInputSource("https://ha.test", "test-token", connect)(id, receive);
  expect(connect).toHaveBeenCalledWith("wss://ha.test/api/websocket");
  socket.emit({ type: "auth_required" });
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
    type: "auth",
    access_token: "test-token",
  });
  socket.emit({ type: "auth_ok" });
  socket.emit({ id: 1, type: "result", success: true });
  expect(JSON.parse(socket.send.mock.calls[2][0])).toEqual({ id: 2, type: "get_states" });
  const event = {
    id: 1,
    type: "event",
    event: { data: { entity_id: id, old_state: entity(), new_state: entity("on", 2) } },
  };
  socket.emit(event);
  expect(receive).not.toHaveBeenCalled();
  socket.emit({ id: 2, type: "result", success: true, result: [entity()] });
  expect(receive).toHaveBeenCalledWith({ current: entity(), snapshot: true });
  socket.emit(event);
  expect(receive).toHaveBeenLastCalledWith({
    current: entity("on", 2),
    previous: entity(),
    snapshot: false,
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(JSON.parse(socket.send.mock.calls.at(-1)?.[0] ?? "null")).toMatchObject({ type: "ping" });
  await vi.advanceTimersByTimeAsync(10_000);
  await connection.done;
  expect(socket.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("closes on rejected auth/subscription and missing snapshot baselines as missing", async () => {
  const socket = new Socket();
  const receive = vi.fn();
  const connection = websocketInputSource(
    "http://ha.test",
    "fixture",
    () => socket as unknown as WebSocket,
  )(id, receive);
  socket.emit({ id: 2, type: "result", success: true, result: [] });
  expect(receive).not.toHaveBeenCalled();
  socket.emit({ type: "auth_ok" });
  socket.emit({ id: 1, type: "result", success: true });
  socket.emit({ id: 2, type: "result", success: true, result: [] });
  expect(receive).toHaveBeenCalledWith({ current: null, snapshot: true });
  socket.emit({ type: "auth_invalid" });
  await connection.done;
  expect(socket.close).toHaveBeenCalledOnce();
});
