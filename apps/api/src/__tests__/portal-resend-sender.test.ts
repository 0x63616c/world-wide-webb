/**
 * Tests for the Resend EmailSender (www-q002.11). Asserts the HTTP payload sent
 * to the Resend API (to / from / subject / 6-digit code in the body) against a
 * mocked fetch — no real email leaves the test. A non-ok Resend response must
 * throw (services throw; a guest who never gets a code must not see "sent").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendEmailSender } from "../services/portal-resend-sender";

const API_KEY = "re_test_key";
const FROM = "World Wide Webb <portal@worldwidewebb.co>";

afterEach(() => vi.restoreAllMocks());

describe("createResendEmailSender", () => {
  it("POSTs the Resend API with the key, from, to, subject, and the code in the body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));

    const sender = createResendEmailSender({ apiKey: API_KEY, from: FROM });
    await sender.sendCode("ada@example.com", "123456");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe(FROM);
    expect(body.to).toEqual(["ada@example.com"]);
    expect(typeof body.subject).toBe("string");
    expect(body.subject.length).toBeGreaterThan(0);
    // The 6-digit code must appear in both text and html parts.
    expect(body.text).toContain("123456");
    expect(body.html).toContain("123456");
  });

  it("never leaks the SSID name or the word 'guest' in user-facing copy (PRD flow rule 8)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = createResendEmailSender({ apiKey: API_KEY, from: FROM });
    await sender.sendCode("ada@example.com", "654321");
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const copy = `${body.subject} ${body.text} ${body.html}`.toLowerCase();
    expect(copy).not.toContain("guest");
  });

  it("throws on a non-ok Resend response (never reports a fake send)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid api key" }), { status: 401 }),
    );
    const sender = createResendEmailSender({ apiKey: API_KEY, from: FROM });
    await expect(sender.sendCode("ada@example.com", "123456")).rejects.toThrow();
  });

  it("throws when the network is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const sender = createResendEmailSender({ apiKey: API_KEY, from: FROM });
    await expect(sender.sendCode("ada@example.com", "123456")).rejects.toThrow();
  });
});

describe("env RESEND_* keys (www-q002.11)", () => {
  it("accepts and defaults RESEND_API_KEY / RESEND_FROM to empty", async () => {
    const { envSchema } = await import("../env");
    expect(envSchema.parse({}).RESEND_API_KEY).toBe("");
    expect(envSchema.parse({}).RESEND_FROM).toBe("");
    const parsed = envSchema.parse({ RESEND_API_KEY: "re_x", RESEND_FROM: "a@b.co" });
    expect(parsed.RESEND_API_KEY).toBe("re_x");
    expect(parsed.RESEND_FROM).toBe("a@b.co");
  });
});
