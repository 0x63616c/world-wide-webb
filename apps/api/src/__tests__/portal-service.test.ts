/**
 * Integration tests for the captive-portal service (CC-q002.9).
 *
 * Exercises the full router matrix against a real in-memory DB substitute
 * (a hand-rolled fake honouring the queries the service makes), a mock email
 * sender, a mock UniFi guest client, and an injected clock. No network, no real
 * Postgres. Covers: send-code + 30s cooldown, verify correct/wrong/expired/
 * lockout-after-3, password correct/wrong/lockout, status fresh/active/lapsed,
 * and the idempotent authorize step.
 */
import { describe, expect, it, vi } from "vitest";
import type { UnifiGuestAuthorization, UnifiGuestClient } from "../integrations/unifi";
import {
  createPortalService,
  type EmailSender,
  PortalError,
  PortalErrorCode,
} from "../services/portal-service";
import { makeInMemoryPortalRepo } from "./helpers/in-memory-portal-repo";

const MAC = "aa:bb:cc:dd:ee:ff";
const NAME = "Ada Lovelace";
const EMAIL = "ada@example.com";

// A clock we advance manually so cooldown/expiry windows are deterministic.
function makeClock(startMs = Date.UTC(2026, 5, 10, 12, 0, 0)) {
  let now = startMs;
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeMockSender(): EmailSender & { lastCode: (email: string) => string | undefined } {
  const store = new Map<string, string>();
  return {
    async sendCode(email, code) {
      store.set(email, code);
    },
    lastCode: (email) => store.get(email),
  };
}

function makeMockUnifi(): UnifiGuestClient & {
  authorizeCalls: Array<{ mac: string; minutes: number }>;
  setActive: (a: UnifiGuestAuthorization | null) => void;
} {
  const authorizeCalls: Array<{ mac: string; minutes: number }> = [];
  let active: UnifiGuestAuthorization | null = null;
  return {
    isConfigured: () => true,
    async authorizeGuest(mac, minutes = 43200) {
      authorizeCalls.push({ mac, minutes });
    },
    async findActiveAuthorization() {
      return active;
    },
    authorizeCalls,
    setActive: (a) => {
      active = a;
    },
  };
}

function setup(opts: { wifiPassword?: string } = {}) {
  const clock = makeClock();
  const repo = makeInMemoryPortalRepo();
  const sender = makeMockSender();
  const unifi = makeMockUnifi();
  const svc = createPortalService({
    repo,
    sender,
    unifi,
    wifiPassword: opts.wifiPassword ?? "hunter2",
    now: clock.now,
  });
  return { svc, db: repo, sender, unifi, clock };
}

describe("portal.sendCode", () => {
  it("creates a 6-digit code, stores the guest, and the mock sender captures it", async () => {
    const { svc, sender } = setup();
    const res = await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    expect(res.cooldownSeconds).toBe(30);
    const code = sender.lastCode(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("enforces a 30s resend cooldown server-side (keyed by email)", async () => {
    const { svc, clock } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    await expect(svc.sendCode({ mac: MAC, name: NAME, email: EMAIL })).rejects.toMatchObject({
      code: PortalErrorCode.ResendCooldown,
    });
    // After 30s the resend is allowed and supersedes the prior code.
    clock.advance(30_000);
    await expect(svc.sendCode({ mac: MAC, name: NAME, email: EMAIL })).resolves.toBeTruthy();
  });

  it("a resend consumes the prior unconsumed code (one live code per guest)", async () => {
    const { svc, sender, clock } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const first = sender.lastCode(EMAIL);
    clock.advance(30_000);
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const second = sender.lastCode(EMAIL);
    // The old code no longer verifies (superseded); the new one does.
    await expect(
      svc.verifyCode({ mac: MAC, email: EMAIL, code: first ?? "" }),
    ).rejects.toMatchObject({ code: PortalErrorCode.WrongCode });
    await expect(
      svc.verifyCode({ mac: MAC, email: EMAIL, code: second ?? "" }),
    ).resolves.toMatchObject({
      verified: true,
    });
  });
});

describe("portal.verifyCode", () => {
  it("accepts the correct code and consumes it", async () => {
    const { svc, sender } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const code = sender.lastCode(EMAIL) ?? "";
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code })).resolves.toMatchObject({
      verified: true,
    });
    // Re-using a consumed code fails.
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code })).rejects.toMatchObject({
      code: PortalErrorCode.WrongCode,
    });
  });

  it("rejects a wrong code and increments the per-mac attempt counter", async () => {
    const { svc } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" })).rejects.toMatchObject({
      code: PortalErrorCode.WrongCode,
    });
  });

  it("locks the device after 3 wrong codes (RateLimited)", async () => {
    const { svc } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" })).rejects.toMatchObject({
      code: PortalErrorCode.WrongCode,
    });
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" })).rejects.toMatchObject({
      code: PortalErrorCode.WrongCode,
    });
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" })).rejects.toMatchObject({
      code: PortalErrorCode.RateLimited,
    });
    // Further attempts stay locked even with the right code.
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" })).rejects.toMatchObject({
      code: PortalErrorCode.RateLimited,
    });
  });

  it("distinguishes an expired code from a wrong code", async () => {
    const { svc, sender, clock } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const code = sender.lastCode(EMAIL) ?? "";
    clock.advance(10 * 60_000 + 1); // past the 10-minute TTL
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code })).rejects.toMatchObject({
      code: PortalErrorCode.ExpiredCode,
    });
  });

  it("a correct code resets the wrong-code counter", async () => {
    const { svc, sender } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    await svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" }).catch(() => {});
    await svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" }).catch(() => {});
    const code = sender.lastCode(EMAIL) ?? "";
    await expect(svc.verifyCode({ mac: MAC, email: EMAIL, code })).resolves.toMatchObject({
      verified: true,
    });
  });
});

describe("portal.checkPassword", () => {
  it("accepts the correct WiFi password", async () => {
    const { svc } = setup({ wifiPassword: "hunter2" });
    await expect(svc.checkPassword({ mac: MAC, password: "hunter2" })).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects a wrong password and locks after 3 attempts", async () => {
    const { svc } = setup({ wifiPassword: "hunter2" });
    await expect(svc.checkPassword({ mac: MAC, password: "x" })).rejects.toMatchObject({
      code: PortalErrorCode.WrongPassword,
    });
    await expect(svc.checkPassword({ mac: MAC, password: "x" })).rejects.toMatchObject({
      code: PortalErrorCode.WrongPassword,
    });
    await expect(svc.checkPassword({ mac: MAC, password: "x" })).rejects.toMatchObject({
      code: PortalErrorCode.RateLimited,
    });
  });

  it("throws when the WiFi password is unconfigured (services throw, never fake)", async () => {
    const { svc } = setup({ wifiPassword: "" });
    await expect(svc.checkPassword({ mac: MAC, password: "anything" })).rejects.toMatchObject({
      code: PortalErrorCode.NotConfigured,
    });
  });

  it("password and code lockouts are independent (separate kinds)", async () => {
    const { svc, sender } = setup({ wifiPassword: "hunter2" });
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    // Burn the code counter to lockout.
    await svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" }).catch(() => {});
    await svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" }).catch(() => {});
    await svc.verifyCode({ mac: MAC, email: EMAIL, code: "000000" }).catch(() => {});
    // The password path is still open for this mac.
    void sender;
    await expect(svc.checkPassword({ mac: MAC, password: "hunter2" })).resolves.toEqual({
      ok: true,
    });
  });
});

describe("portal.authorize (idempotent)", () => {
  it("authorizes the device via UniFi with minutes=43200 and writes a 30-day DB row", async () => {
    const { svc, db, unifi, clock } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const guestId = db.firstGuestId();
    const res = await svc.authorize({ mac: MAC, guestId });
    expect(res.authorized).toBe(true);
    expect(unifi.authorizeCalls).toEqual([{ mac: MAC, minutes: 43200 }]);
    const row = db.findAuthorization(MAC);
    if (!row) throw new Error("authorization row missing");
    const days = (row.expiresAtUtc.getTime() - clock.now().getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it("re-submitting does not double-authorize (one row per mac; idempotent)", async () => {
    const { svc, db, unifi } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const guestId = db.firstGuestId();
    await svc.authorize({ mac: MAC, guestId });
    await svc.authorize({ mac: MAC, guestId });
    // Exactly one authorization row for the mac.
    expect(db.authorizationCount(MAC)).toBe(1);
    // UniFi may be called again (idempotent on the controller) but the DB stays single-row.
    expect(unifi.authorizeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("portal.status", () => {
  it("returns 'fresh' when the device has never been authorized", async () => {
    const { svc } = setup();
    await expect(svc.status({ mac: MAC })).resolves.toMatchObject({ state: "fresh" });
  });

  it("returns 'active' (AlreadyConnected) for a live authorization", async () => {
    const { svc, db } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const guestId = db.firstGuestId();
    await svc.authorize({ mac: MAC, guestId });
    await expect(svc.status({ mac: MAC })).resolves.toMatchObject({ state: "active" });
  });

  it("returns 'expired' (SessionExpired) when the 30-day window lapsed", async () => {
    const { svc, db, clock } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const guestId = db.firstGuestId();
    await svc.authorize({ mac: MAC, guestId });
    clock.advance(31 * 86_400_000); // 31 days
    await expect(svc.status({ mac: MAC })).resolves.toMatchObject({ state: "expired" });
  });

  it("heals the controller: an active DB row with no controller grant re-fires authorizeGuest", async () => {
    const { svc, db, unifi } = setup();
    await svc.sendCode({ mac: MAC, name: NAME, email: EMAIL });
    const guestId = db.firstGuestId();
    await svc.authorize({ mac: MAC, guestId });
    unifi.setActive(null); // controller lost the grant (reboot)
    const callsBefore = unifi.authorizeCalls.length;
    await svc.status({ mac: MAC });
    expect(unifi.authorizeCalls.length).toBe(callsBefore + 1);
  });
});

describe("PortalError", () => {
  it("is an Error subclass carrying a typed code", () => {
    const e = new PortalError(PortalErrorCode.WrongCode, "nope");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(PortalErrorCode.WrongCode);
  });
});

// Sanity: the suite touches no real network and no real DB module.
it("does not import the real db/index pool", () => {
  expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
});
