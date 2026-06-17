import { describe, expect, it, vi } from "vitest";
import { type PortalClient, runEffect, statusToEvent } from "./effects";

const MAC = "aa:bb:cc:dd:ee:ff";

// Build a mock PortalClient where each method resolves or rejects as configured.
function client(over: Partial<PortalClient> = {}): PortalClient {
  return {
    checkPassword: vi.fn(async () => ({ ok: true as const })),
    authorize: vi.fn(async () => ({ authorized: true as const })),
    status: vi.fn(async () => ({ state: "fresh" as const })),
    ...over,
  };
}

// A thrown error carrying a structural portal code (the preferred channel).
const withCode = (portalCode: string) => ({ data: { portalCode } });
// A thrown error carrying the code only in the "CODE: message" prefix (fallback).
const withPrefix = (code: string) => ({ message: `${code}: human readable` });

describe("statusToEvent", () => {
  it("maps active → AlreadyConnected, expired → SessionExpired, fresh → null", () => {
    expect(statusToEvent("active")).toEqual({ type: "SHOW_ALREADY_CONNECTED" });
    expect(statusToEvent("expired")).toEqual({ type: "SHOW_SESSION_EXPIRED" });
    expect(statusToEvent("fresh")).toBeNull();
  });
});

describe("checkPassword effect", () => {
  it("ok → PASSWORD_OK", async () => {
    const events = await runEffect(client(), { type: "checkPassword", password: "p", mac: MAC });
    expect(events).toEqual([{ type: "PASSWORD_OK" }]);
  });

  it("WRONG_PASSWORD (structural) → PASSWORD_WRONG", async () => {
    const c = client({
      checkPassword: vi.fn(async () => {
        throw withCode("WRONG_PASSWORD");
      }),
    });
    expect(await runEffect(c, { type: "checkPassword", password: "x", mac: MAC })).toEqual([
      { type: "PASSWORD_WRONG" },
    ]);
  });

  it("WRONG_PASSWORD (message-prefix fallback) → PASSWORD_WRONG", async () => {
    const c = client({
      checkPassword: vi.fn(async () => {
        throw withPrefix("WRONG_PASSWORD");
      }),
    });
    expect(await runEffect(c, { type: "checkPassword", password: "x", mac: MAC })).toEqual([
      { type: "PASSWORD_WRONG" },
    ]);
  });

  it("RATE_LIMITED → SHOW_RATELIMIT", async () => {
    const c = client({
      checkPassword: vi.fn(async () => {
        throw withCode("RATE_LIMITED");
      }),
    });
    expect(await runEffect(c, { type: "checkPassword", password: "x", mac: MAC })).toEqual([
      { type: "SHOW_RATELIMIT" },
    ]);
  });

  it("NOT_CONFIGURED → SHOW_ERROR", async () => {
    const c = client({
      checkPassword: vi.fn(async () => {
        throw withCode("NOT_CONFIGURED");
      }),
    });
    expect(await runEffect(c, { type: "checkPassword", password: "x", mac: MAC })).toEqual([
      { type: "SHOW_ERROR" },
    ]);
  });

  it("untyped/network failure → CONNECT_FAILED", async () => {
    const c = client({
      checkPassword: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    expect(await runEffect(c, { type: "checkPassword", password: "x", mac: MAC })).toEqual([
      { type: "CONNECT_FAILED" },
    ]);
  });
});

describe("authorize effect", () => {
  it("ok → CONNECT_OK and passes only the mac (no guestId)", async () => {
    const authorize = vi.fn(async () => ({ authorized: true as const }));
    const events = await runEffect(client({ authorize }), { type: "authorize", mac: MAC });
    expect(events).toEqual([{ type: "CONNECT_OK" }]);
    expect(authorize).toHaveBeenCalledWith({ mac: MAC });
  });

  it("RATE_LIMITED → SHOW_RATELIMIT", async () => {
    const c = client({
      authorize: vi.fn(async () => {
        throw withCode("RATE_LIMITED");
      }),
    });
    expect(await runEffect(c, { type: "authorize", mac: MAC })).toEqual([
      { type: "SHOW_RATELIMIT" },
    ]);
  });

  it("network failure → CONNECT_FAILED", async () => {
    const c = client({
      authorize: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await runEffect(c, { type: "authorize", mac: MAC })).toEqual([
      { type: "CONNECT_FAILED" },
    ]);
  });
});
