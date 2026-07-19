/**
 * Tests for the APNs sender. Two things are worth pinning: the ES256 provider
 * JWT (wrong claims or a mis-encoded signature means every push 403s, and that
 * failure is invisible from our side), and the stale-token path, where a 410 /
 * BadDeviceToken must DELETE the row rather than retry forever.
 *
 * Follows asc-version-service.test.ts: the JWT test signs with a locally
 * generated P-256 key and verifies the signature with the matching public key,
 * so it proves real cryptographic correctness without a real .p8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  APNS_KEY_ID: "TESTKEY123",
  APNS_TEAM_ID: "TEAM123456",
  APNS_KEY_CONTENT: "",
  APNS_BUNDLE_ID: "co.worldwidewebb.theworkflowengine",
  APNS_HOST: "https://api.push.apple.com",
}));
vi.mock("../env", () => ({ env: envMock }));

/**
 * node:http2 stand-in. APNs is HTTP/2-only and Bun's fetch cannot speak it, so
 * the sender uses node:http2 directly and these tests drive that transport
 * rather than a fetch stub. `h2` is the knob each test sets: a status+body to
 * reply with, or an error to emit instead.
 */
const h2 = vi.hoisted(() => ({
  status: 200,
  body: "",
  error: null as Error | null,
  /** Records what the sender actually sent, so header/path assertions can run. */
  lastRequest: null as { headers: Record<string, string>; body: string; origin: string } | null,
}));

vi.mock("node:http2", () => {
  const connect = (origin: string) => {
    const sessionHandlers: Record<string, (arg: unknown) => void> = {};
    return {
      on: (event: string, fn: (arg: unknown) => void) => {
        sessionHandlers[event] = fn;
      },
      close: () => {},
      request: (headers: Record<string, string>) => {
        const handlers: Record<string, (arg: unknown) => void> = {};
        return {
          on: (event: string, fn: (arg: unknown) => void) => {
            handlers[event] = fn;
          },
          setTimeout: () => {},
          setEncoding: () => {},
          destroy: () => {},
          end: (body: string) => {
            h2.lastRequest = { headers, body, origin };
            // Async so the sender's promise wiring is exercised for real.
            queueMicrotask(() => {
              if (h2.error) {
                handlers.error?.(h2.error);
                return;
              }
              handlers.response?.({ ":status": h2.status });
              if (h2.body) handlers.data?.(h2.body);
              handlers.end?.(undefined);
            });
          },
        };
      },
    };
  };
  return { default: { connect }, connect };
});

import {
  type ApnsAlert,
  buildApnsPayload,
  isApnsConfigured,
  sendApnsPush,
  signApnsJwt,
} from "../services/apns-service";

async function generateP8Pem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return {
    pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`,
    publicKey: pair.publicKey,
  };
}

function b64urlToJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString());
}

/** A minimal db mock that records delete() calls. */
function makeDb() {
  const state = { deletes: 0 };
  const db = {
    delete: () => {
      state.deletes++;
      return { where: () => Promise.resolve(undefined) };
    },
  } as never;
  return { db, state };
}

const alert: ApnsAlert = {
  notificationId: "notif_deadbeef",
  title: "Deploy failed",
  body: "ci.yml failed on main",
  category: "ci",
  severity: "critical",
  deepLink: "/deploys",
  badge: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── configuration gate ──────────────────────────────────────────────────────

describe("isApnsConfigured", () => {
  beforeEach(() => {
    envMock.APNS_KEY_CONTENT = "";
  });

  it("is false without key content, and sending is a no-op", async () => {
    expect(isApnsConfigured()).toBe(false);
    h2.lastRequest = null;
    const { db } = makeDb();
    expect(await sendApnsPush(db, "tok", alert)).toBe("skipped");
    // Nothing must hit the wire when APNs is unconfigured.
    expect(h2.lastRequest).toBeNull();
  });

  it("is true once all four values are present", async () => {
    envMock.APNS_KEY_CONTENT = (await generateP8Pem()).pem;
    expect(isApnsConfigured()).toBe(true);
  });
});

// ─── JWT construction ────────────────────────────────────────────────────────

describe("signApnsJwt", () => {
  it("builds an ES256 header with the key id and APNs claims", async () => {
    const { pem } = await generateP8Pem();
    const jwt = await signApnsJwt("KEY123", "TEAM456", pem, 1_800_000_000_000);
    const [h, p] = jwt.split(".");
    expect(b64urlToJson(h as string)).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    const payload = b64urlToJson(p as string);
    // APNs wants the TEAM id as iss and no aud  --  this is the one place it
    // differs from the otherwise-identical ASC token.
    expect(payload.iss).toBe("TEAM456");
    expect(payload).not.toHaveProperty("aud");
    expect(payload.iat).toBe(1_800_000_000);
    expect(payload.exp).toBe(1_800_000_000 + 30 * 60);
  });

  it("produces a signature that verifies against the key (raw R||S, not DER)", async () => {
    const { pem, publicKey } = await generateP8Pem();
    const jwt = await signApnsJwt("KEY123", "TEAM456", pem);
    const [h, p, s] = jwt.split(".");
    const sig = Buffer.from(s as string, "base64url");
    // ES256 raw signatures are exactly 64 bytes; a DER-encoded one would not be
    // and Apple would reject it.
    expect(sig.byteLength).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("accepts a base64-wrapped .p8 with no PEM armor (the vault's storage form)", async () => {
    const { pem } = await generateP8Pem();
    const wrapped = Buffer.from(pem, "utf-8").toString("base64");
    await expect(signApnsJwt("KEY123", "TEAM456", wrapped)).resolves.toContain(".");
  });
});

// ─── payload shape ───────────────────────────────────────────────────────────

describe("buildApnsPayload", () => {
  it("nests title/body under aps.alert and hoists routing keys to the top level", () => {
    const body = buildApnsPayload(alert);
    expect(body.aps).toMatchObject({
      alert: { title: "Deploy failed", body: "ci.yml failed on main" },
      badge: 3,
    });
    expect(body.notificationId).toBe("notif_deadbeef");
    expect(body.deepLink).toBe("/deploys");
  });

  it("omits body and deepLink when absent rather than sending nulls", () => {
    const body = buildApnsPayload({
      notificationId: "notif_1",
      title: "Hi",
      category: "home",
      severity: "info",
    });
    expect((body.aps as { alert: object }).alert).toEqual({ title: "Hi" });
    expect(body).not.toHaveProperty("deepLink");
  });
});

// ─── send path ───────────────────────────────────────────────────────────────

describe("sendApnsPush", () => {
  beforeEach(async () => {
    envMock.APNS_KEY_CONTENT = (await generateP8Pem()).pem;
  });

  it("POSTs over HTTP/2 to the production host with the APNs headers", async () => {
    h2.status = 200;
    h2.body = "";
    h2.error = null;
    const { db } = makeDb();

    expect(await sendApnsPush(db, "abc123token", alert)).toBe("sent");

    const sent = h2.lastRequest;
    // TestFlight builds are PRODUCTION push clients, so this must never be the
    // sandbox host.
    expect(sent?.origin).toBe("https://api.push.apple.com");
    expect(sent?.headers[":path"]).toBe("/3/device/abc123token");
    expect(sent?.headers[":method"]).toBe("POST");
    expect(sent?.headers.authorization).toMatch(/^bearer eyJ/);
    expect(sent?.headers["apns-topic"]).toBe("co.worldwidewebb.theworkflowengine");
    expect(sent?.headers["apns-push-type"]).toBe("alert");
  });

  it("deletes the token row on a 410 Unregistered", async () => {
    h2.status = 410;
    h2.body = JSON.stringify({ reason: "Unregistered" });
    h2.error = null;
    const { db, state } = makeDb();
    expect(await sendApnsPush(db, "deadtoken", alert)).toBe("stale");
    expect(state.deletes).toBe(1);
  });

  it("deletes the token row on a 400 BadDeviceToken", async () => {
    h2.status = 400;
    h2.body = JSON.stringify({ reason: "BadDeviceToken" });
    h2.error = null;
    const { db, state } = makeDb();
    expect(await sendApnsPush(db, "badtoken", alert)).toBe("stale");
    expect(state.deletes).toBe(1);
  });

  it("keeps the token on a transient 500 so a retry can still deliver", async () => {
    h2.status = 500;
    h2.body = "";
    h2.error = null;
    const { db, state } = makeDb();
    expect(await sendApnsPush(db, "goodtoken", alert)).toBe("failed");
    expect(state.deletes).toBe(0);
  });

  it("absorbs a connection error instead of failing the whole fan-out", async () => {
    // The real regression: Bun's fetch could not do HTTP/2 and every push threw
    // Malformed_HTTP_Response. A transport error must stay contained here.
    h2.error = new Error("ECONNRESET");
    const { db } = makeDb();
    expect(await sendApnsPush(db, "tok", alert)).toBe("failed");
  });
});
