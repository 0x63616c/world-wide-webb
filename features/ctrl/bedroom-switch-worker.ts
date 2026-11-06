import type { HaEntity } from "@www/core";
import { getLogger } from "@www/logger";
import { createBedroomSwitch, verifiedInput } from "./bedroom-switch";
import { config } from "./config";
import { deviceStateStore } from "./db";
import { ha } from "./deps";

export interface InputMessage {
  current: HaEntity | null;
  previous?: HaEntity | null;
  snapshot: boolean;
}
interface InputConnection {
  close(): void;
  done: Promise<void>;
}
export type InputSource = (
  entityId: string,
  receive: (message: InputMessage) => void,
) => InputConnection;

/** HA protocol transport. No REST/device calls. Subscription precedes get_states;
 * events before the snapshot result are ignored, then old_state continuity is required.
 * Ping timeout closes a silent gap and the worker reconnects with a fresh baseline. */
export function websocketInputSource(
  url: string,
  token: string,
  connect: (url: string) => WebSocket = (url) => new WebSocket(url),
): InputSource {
  return (entityId, receive) => {
    const endpoint = new URL("api/websocket", `${url.replace(/\/$/, "")}/`);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = connect(endpoint.toString());
    let phase: "auth" | "subscription" | "snapshot" | "live" = "auth";
    let ready = false;
    let closed = false;
    let pong = true;
    let pingId = 10;
    let resolveDone = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const send = (message: object) => socket.send(JSON.stringify(message));
    // Covers auth, subscription and snapshot stalls as well as dead connections.
    let deadline = Date.now() + 15_000;
    const timer = setInterval(() => {
      if (Date.now() > deadline || !pong) {
        close();
        return;
      }
      if (ready) {
        pong = false;
        send({ id: ++pingId, type: "ping" });
      }
    }, 10_000);
    const close = () => {
      if (closed) return;
      closed = true;
      ready = false;
      clearInterval(timer);
      socket.close();
      resolveDone();
    };
    socket.onclose = () => {
      closed = true;
      ready = false;
      clearInterval(timer);
      resolveDone();
    };
    socket.onerror = close;
    socket.onmessage = (event) => {
      if (closed) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "auth_required" && phase === "auth")
          send({ type: "auth", access_token: token });
        else if (message.type === "auth_ok" && phase === "auth") {
          phase = "subscription";
          send({ id: 1, type: "subscribe_events", event_type: "state_changed" });
        } else if (message.type === "auth_invalid") close();
        else if (message.type === "pong") {
          pong = true;
          deadline = Date.now() + 25_000;
        } else if (message.type === "result" && message.id === 1 && phase === "subscription") {
          if (!message.success) {
            close();
            return;
          }
          phase = "snapshot";
          send({ id: 2, type: "get_states" });
        } else if (message.type === "result" && message.id === 2 && phase === "snapshot") {
          if (!message.success || !Array.isArray(message.result)) {
            close();
            return;
          }
          receive({
            current: message.result.find((e: HaEntity) => e.entity_id === entityId) ?? null,
            snapshot: true,
          });
          phase = "live";
          ready = true;
          deadline = Date.now() + 25_000;
        } else if (
          ready &&
          message.type === "event" &&
          message.id === 1 &&
          message.event?.data?.entity_id === entityId
        ) {
          receive({
            current: message.event.data.new_state,
            previous: message.event.data.old_state,
            snapshot: false,
          });
        }
      } catch {
        close();
      }
    };
    return { close, done };
  };
}

/** Injectable supervisor: disabled config doesn't even construct a transport or touch the store. */
export function createInputWorker(
  settings: Parameters<typeof verifiedInput>[0],
  store: Parameters<typeof createBedroomSwitch>[1],
  source: () => InputSource,
) {
  let connection: InputConnection | null = null;
  let pending = Promise.resolve();
  let queued = 0;
  let active = false;
  return {
    name: "bedroom-switch-input",
    intervalMs: 5_000,
    runOnStart: true,
    async run() {
      const id = verifiedInput(settings);
      if (!id || connection) return;
      const binding = createBedroomSwitch(settings, store);
      active = true;
      connection = source()(id, (message) => {
        // Bound backpressure. On overload drop the session, never infer missed flips.
        if (!active) return;
        if (queued >= 100) {
          active = false;
          connection?.close();
          return;
        }
        queued += 1;
        pending = pending
          .then(async () => {
            if (active) await binding.sample(message.current, message.snapshot, message.previous);
          })
          .catch(() => {
            active = false;
            connection?.close();
            getLogger().error("bedroom switch input failed; rebaseline required");
          })
          .finally(() => {
            queued -= 1;
          });
      });
      const current = connection;
      void current.done.then(async () => {
        active = false;
        await pending;
        if (connection === current) connection = null;
      });
    },
    async stop() {
      active = false;
      connection?.close();
      await pending;
      connection = null;
    },
  };
}

export const bedroomSwitchWorker = createInputWorker(config, deviceStateStore, () => {
  if (!ha.isConfigured()) throw new Error("Home Assistant is not configured");
  return websocketInputSource(config.HA_URL, config.HA_TOKEN);
});
