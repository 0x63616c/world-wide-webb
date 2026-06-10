import { describe, expect, it, vi } from "vitest";
import { type PortalClient, runEffect, statusToEvent } from "./effects";

const MAC = "aa:bb:cc:dd:ee:ff";

// A typed-enough mock of the portal client surface runEffect uses.
function mockClient(over: Partial<PortalClient> = {}): PortalClient {
  return {
    sendCode: vi.fn(async () => ({ cooldownSeconds: 30 })),
    verifyCode: vi.fn(async () => ({ verified: true as const, guestId: "gst_1" })),
    checkPassword: vi.fn(async () => ({ ok: true as const })),
    authorize: vi.fn(async () => ({ authorized: true as const })),
    status: vi.fn(async () => ({ state: "fresh" as const })),
    resetAttempts: vi.fn(async () => ({ reset: true as const })),
    ...over,
  };
}

// Build a tRPC-shaped error whose message tail carries the typed portal code,
// exactly as the backend formats it: "WRONG_CODE: that code didn't match".
function portalErr(code: string): Error {
  return new Error(`${code}: server message`);
}

describe("runEffect, sendCode", () => {
  it("success emits CODE_SENT", async () => {
    const c = mockClient();
    const events = await runEffect(
      c,
      { type: "sendCode", email: "j@x.co", mac: MAC },
      { name: "John" },
    );
    expect(c.sendCode).toHaveBeenCalledWith({ mac: MAC, name: "John", email: "j@x.co" });
    expect(events).toContainEqual({ type: "CODE_SENT" });
  });

  it("RESEND_COOLDOWN does not crash the flow (stays on verify, no SEND_FAILED)", async () => {
    const c = mockClient({
      sendCode: vi.fn(async () => {
        throw portalErr("RESEND_COOLDOWN");
      }),
    });
    const events = await runEffect(
      c,
      { type: "sendCode", email: "j@x.co", mac: MAC },
      { name: "John" },
    );
    expect(events.some((e) => e.type === "SEND_FAILED")).toBe(false);
  });

  it("NOT_CONFIGURED emits SHOW_ERROR (GenericError)", async () => {
    const c = mockClient({
      sendCode: vi.fn(async () => {
        throw portalErr("NOT_CONFIGURED");
      }),
    });
    const events = await runEffect(
      c,
      { type: "sendCode", email: "j@x.co", mac: MAC },
      { name: "John" },
    );
    expect(events).toContainEqual({ type: "SHOW_ERROR" });
  });

  it("a network failure (untyped error) emits SEND_FAILED", async () => {
    const c = mockClient({
      sendCode: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    });
    const events = await runEffect(
      c,
      { type: "sendCode", email: "j@x.co", mac: MAC },
      { name: "John" },
    );
    expect(events).toContainEqual({ type: "SEND_FAILED" });
  });
});

describe("runEffect, verifyCode", () => {
  it("success threads guestId into VERIFY_OK", async () => {
    const c = mockClient();
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "123456", mac: MAC },
      { email: "j@x.co" },
    );
    expect(c.verifyCode).toHaveBeenCalledWith({ mac: MAC, email: "j@x.co", code: "123456" });
    expect(events).toContainEqual({ type: "VERIFY_OK", guestId: "gst_1" });
  });

  it("WRONG_CODE emits VERIFY_WRONG", async () => {
    const c = mockClient({
      verifyCode: vi.fn(async () => {
        throw portalErr("WRONG_CODE");
      }),
    });
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "000000", mac: MAC },
      { email: "j@x.co" },
    );
    expect(events).toContainEqual({ type: "VERIFY_WRONG" });
  });

  it("EXPIRED_CODE emits VERIFY_EXPIRED (distinct from wrong)", async () => {
    const c = mockClient({
      verifyCode: vi.fn(async () => {
        throw portalErr("EXPIRED_CODE");
      }),
    });
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "000000", mac: MAC },
      { email: "j@x.co" },
    );
    expect(events).toContainEqual({ type: "VERIFY_EXPIRED" });
  });

  it("NO_ACTIVE_CODE is treated as expired (request a new one)", async () => {
    const c = mockClient({
      verifyCode: vi.fn(async () => {
        throw portalErr("NO_ACTIVE_CODE");
      }),
    });
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "000000", mac: MAC },
      { email: "j@x.co" },
    );
    expect(events).toContainEqual({ type: "VERIFY_EXPIRED" });
  });

  it("RATE_LIMITED on verify emits a RETRY-blocked rate-limit (SHOW_RATELIMIT)", async () => {
    const c = mockClient({
      verifyCode: vi.fn(async () => {
        throw portalErr("RATE_LIMITED");
      }),
    });
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "000000", mac: MAC },
      { email: "j@x.co" },
    );
    expect(events).toContainEqual({ type: "SHOW_RATELIMIT" });
  });

  it("network failure on verify emits SHOW_ERROR", async () => {
    const c = mockClient({
      verifyCode: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const events = await runEffect(
      c,
      { type: "verifyCode", code: "000000", mac: MAC },
      { email: "j@x.co" },
    );
    expect(events).toContainEqual({ type: "SHOW_ERROR" });
  });
});

describe("runEffect, checkPassword + authorize (idempotent connect)", () => {
  it("password OK then authorize OK emits PASSWORD_OK then CONNECT_OK", async () => {
    const c = mockClient();
    const ev1 = await runEffect(c, { type: "checkPassword", password: "hunter2", mac: MAC }, {});
    expect(c.checkPassword).toHaveBeenCalledWith({ mac: MAC, password: "hunter2" });
    expect(ev1).toContainEqual({ type: "PASSWORD_OK" });
    const ev2 = await runEffect(c, { type: "authorize", mac: MAC }, { guestId: "gst_1" });
    expect(c.authorize).toHaveBeenCalledWith({ mac: MAC, guestId: "gst_1" });
    expect(ev2).toContainEqual({ type: "CONNECT_OK" });
  });

  it("WRONG_PASSWORD emits PASSWORD_WRONG", async () => {
    const c = mockClient({
      checkPassword: vi.fn(async () => {
        throw portalErr("WRONG_PASSWORD");
      }),
    });
    const events = await runEffect(c, { type: "checkPassword", password: "nope", mac: MAC }, {});
    expect(events).toContainEqual({ type: "PASSWORD_WRONG" });
  });

  it("RATE_LIMITED on password emits SHOW_RATELIMIT", async () => {
    const c = mockClient({
      checkPassword: vi.fn(async () => {
        throw portalErr("RATE_LIMITED");
      }),
    });
    const events = await runEffect(c, { type: "checkPassword", password: "nope", mac: MAC }, {});
    expect(events).toContainEqual({ type: "SHOW_RATELIMIT" });
  });

  it("authorize network failure emits CONNECT_FAILED (back to password + alert)", async () => {
    const c = mockClient({
      authorize: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const events = await runEffect(c, { type: "authorize", mac: MAC }, { guestId: "gst_1" });
    expect(events).toContainEqual({ type: "CONNECT_FAILED" });
  });
});

describe("runEffect, resetAttempts (fire-and-forget)", () => {
  it("calls resetAttempts and emits NO events (back nav already transitioned)", async () => {
    const c = mockClient();
    const events = await runEffect(c, { type: "resetAttempts", mac: MAC }, {});
    expect(c.resetAttempts).toHaveBeenCalledWith({ mac: MAC });
    expect(events).toEqual([]);
  });

  it("a failed resetAttempts is swallowed (fire-and-forget, no event, no throw)", async () => {
    const c = mockClient({
      resetAttempts: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const events = await runEffect(c, { type: "resetAttempts", mac: MAC }, {});
    expect(events).toEqual([]);
  });
});

describe("statusToEvent, boot short-circuit", () => {
  it("active -> SHOW_ALREADY_CONNECTED", () => {
    expect(statusToEvent("active")).toEqual({ type: "SHOW_ALREADY_CONNECTED" });
  });
  it("expired -> SHOW_SESSION_EXPIRED", () => {
    expect(statusToEvent("expired")).toEqual({ type: "SHOW_SESSION_EXPIRED" });
  });
  it("fresh -> null (stay on landing)", () => {
    expect(statusToEvent("fresh")).toBeNull();
  });
});
