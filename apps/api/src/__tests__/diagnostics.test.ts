import { describe, expect, it, vi } from "vitest";
import {
  createDiagnosticsStore,
  diagnosticsRouter,
  homeAssistantStatus,
} from "../trpc/routers/diagnostics";

const report = () => ({
  snapshot: {
    source: "live",
    backendURL: "https://panel.example",
    build: "123",
    gitSHA: "dev",
    backend: "reachable",
    latencyMs: 42,
    homeAssistant: "connected",
  },
  commands: [
    {
      control: "controls.toggle",
      payload: { on: "1", id: "<redacted>" },
      status: 200,
      latencyMs: 12,
    },
  ],
});

describe("kiosk diagnostics", () => {
  it("retains the newest 20 submissions in order with server timestamps", () => {
    const store = createDiagnosticsStore();
    for (let i = 0; i < 25; i++) {
      const input = report();
      input.snapshot.build = String(i);
      expect(store.submit(input)).toEqual({ accepted: true });
    }
    const saved = store.list();
    expect(saved).toHaveLength(20);
    expect(saved.map((value) => value.snapshot.build)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 5)),
    );
    expect(Number.isNaN(Date.parse(saved[0].timestamp))).toBe(false);
    saved.splice(0);
    expect(store.list()).toHaveLength(20);
  });
  it("rejects excessive entries, unsafe payloads, extra headers and credential URLs", () => {
    const store = createDiagnosticsStore();
    const input = report();
    expect(() => store.submit({ ...input, commands: Array(51).fill(input.commands[0]) })).toThrow();
    for (const payload of [
      { "CF-Access-Client-Secret": "secret" },
      { id: "someone@example.com" },
      { headers: "<redacted>" },
    ]) {
      expect(() =>
        store.submit({ ...input, commands: [{ ...input.commands[0], payload }] }),
      ).toThrow();
    }
    expect(() => store.submit({ ...input, headers: { Authorization: "secret" } })).toThrow();
    for (const backendURL of [
      "https://user:secret@panel.example",
      "https://panel.example?token=secret",
      "https://panel.example/private",
    ]) {
      expect(() =>
        store.submit({ ...input, snapshot: { ...input.snapshot, backendURL } }),
      ).toThrow();
    }
    expect(() =>
      store.submit({ ...input, commands: [{ ...input.commands[0], error: "secret" }] }),
    ).toThrow();
  });
  it("bounds total serialized report size", () => {
    const keys = [
      "on",
      "enabled",
      "brightness",
      "kelvin",
      "temperature",
      "target",
      "low",
      "high",
      "volume",
      "position",
      "mode",
      "speed",
      "color",
      "id",
      "roomId",
      "entityId",
    ];
    const payload = Object.fromEntries(keys.map((key) => [key, "1".repeat(32)]));
    expect(() =>
      createDiagnosticsStore().submit({
        ...report(),
        commands: Array(50).fill({ control: "a".repeat(80), payload, latencyMs: 0 }),
      }),
    ).toThrow("too large");
  });
  it("supports tRPC POST submission and GET listing through the normal kiosk procedures", async () => {
    const caller = diagnosticsRouter.createCaller({} as never);
    await expect(caller.submit(report() as never)).resolves.toEqual({ accepted: true });
    expect((await caller.submissions()).at(-1)?.snapshot.build).toBe("123");
    await expect(caller.submit({ ...report(), headers: "secret" } as never)).rejects.toThrow();
  });
  it("reports HA reachability without returning entity data, tokens or raw errors", async () => {
    const client = {
      isConfigured: () => true,
      getEntities: vi.fn().mockResolvedValue([{ attributes: { secret: "token" } }]),
    };
    expect(await homeAssistantStatus(client as never)).toBe("connected");
    client.getEntities.mockRejectedValue(new Error("token"));
    expect(await homeAssistantStatus(client as never)).toBe("unavailable");
    expect(await homeAssistantStatus({ ...client, isConfigured: () => false } as never)).toBe(
      "unconfigured",
    );
  });
});
