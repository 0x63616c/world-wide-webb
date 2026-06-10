// Effect runner: executes a PortalEffect against the tRPC portal client and maps
// the result (or a typed PortalError) onto the FlowEvent(s) to dispatch. This is
// the .7-to-.9 seam (CC-q002.19), the reducer emits effects, this runs them.
// Pure mapping over an injectable client, so every effect->event path is unit
// tested with a mock (no network).
import type { FlowEvent, PortalEffect } from "./flow";

// The slice of the portal router this runner calls. The real client (typed via
// AppRouter, src/lib/trpc.ts) structurally satisfies this; tests inject a mock.
export interface PortalClient {
  sendCode(input: {
    mac: string;
    name: string;
    email: string;
  }): Promise<{ cooldownSeconds: number }>;
  verifyCode(input: {
    mac: string;
    email: string;
    code: string;
  }): Promise<{ verified: true; guestId: string }>;
  checkPassword(input: { mac: string; password: string }): Promise<{ ok: true }>;
  authorize(input: { mac: string; guestId: string }): Promise<{ authorized: true }>;
  status(input: { mac: string }): Promise<{ state: "fresh" | "active" | "expired" }>;
  resetAttempts(input: { mac: string }): Promise<{ reset: true }>;
}

// The typed portal codes the backend exposes. Preferred channel is the
// structural `error.data.portalCode` (errorFormatter, CC-q002.19 backend half);
// the "CODE: message" prefix parse is a transitional fallback so we aren't
// blocked on backend commit ordering (lead ruling).
type PortalCode =
  | "WRONG_CODE"
  | "EXPIRED_CODE"
  | "WRONG_PASSWORD"
  | "RATE_LIMITED"
  | "RESEND_COOLDOWN"
  | "NOT_CONFIGURED"
  | "NO_ACTIVE_CODE";

const KNOWN_CODES: ReadonlySet<string> = new Set<PortalCode>([
  "WRONG_CODE",
  "EXPIRED_CODE",
  "WRONG_PASSWORD",
  "RATE_LIMITED",
  "RESEND_COOLDOWN",
  "NOT_CONFIGURED",
  "NO_ACTIVE_CODE",
]);

/** Extract the typed portal code from a thrown error, or null if it's an
 *  untyped (e.g. network) failure. Prefers structural data.portalCode; falls
 *  back to the "CODE: message" prefix the router currently formats. */
function parsePortalError(err: unknown): PortalCode | null {
  if (!err || typeof err !== "object") return null;
  // Preferred: structural code from the tRPC errorFormatter.
  const data = (err as { data?: { portalCode?: unknown } }).data;
  if (data && typeof data.portalCode === "string" && KNOWN_CODES.has(data.portalCode)) {
    return data.portalCode as PortalCode;
  }
  // Transitional fallback: "CODE: human message" in the error message.
  const msg = (err as { message?: unknown }).message;
  if (typeof msg === "string") {
    const head = msg.split(":", 1)[0]?.trim();
    if (head && KNOWN_CODES.has(head)) return head as PortalCode;
  }
  return null;
}

/** Boot status -> the screen short-circuit event (or null = stay on landing). */
export function statusToEvent(state: "fresh" | "active" | "expired"): FlowEvent | null {
  if (state === "active") return { type: "SHOW_ALREADY_CONNECTED" };
  if (state === "expired") return { type: "SHOW_SESSION_EXPIRED" };
  return null;
}

// Per-effect context the reducer doesn't carry in the effect itself (name for
// sendCode, email for verifyCode, guestId for authorize), supplied by the App
// from current flow state when it runs the effect.
export interface EffectContext {
  name?: string;
  email?: string;
  guestId?: string;
}

export async function runEffect(
  client: PortalClient,
  effect: PortalEffect,
  ctx: EffectContext = {},
): Promise<FlowEvent[]> {
  switch (effect.type) {
    case "sendCode":
      try {
        await client.sendCode({ mac: effect.mac, name: ctx.name ?? "", email: effect.email });
        return [{ type: "CODE_SENT" }];
      } catch (err) {
        const code = parsePortalError(err);
        // A resend-cooldown race is benign (the verify screen owns the timer);
        // a real config failure is a generic error; anything else is a send
        // failure -> the error screen path.
        if (code === "RESEND_COOLDOWN") return [];
        if (code === "NOT_CONFIGURED") return [{ type: "SHOW_ERROR" }];
        return [{ type: "SEND_FAILED" }];
      }

    case "verifyCode":
      try {
        const res = await client.verifyCode({
          mac: effect.mac,
          email: ctx.email ?? "",
          code: effect.code,
        });
        return [{ type: "VERIFY_OK", guestId: res.guestId }];
      } catch (err) {
        const code = parsePortalError(err);
        if (code === "WRONG_CODE") return [{ type: "VERIFY_WRONG" }];
        // Expired and no-active-code both mean "request a new one".
        if (code === "EXPIRED_CODE" || code === "NO_ACTIVE_CODE")
          return [{ type: "VERIFY_EXPIRED" }];
        if (code === "RATE_LIMITED") return [{ type: "SHOW_RATELIMIT" }];
        // Untyped/network failure: don't strand the user on a silent verify.
        return [{ type: "SHOW_ERROR" }];
      }

    case "checkPassword":
      try {
        await client.checkPassword({ mac: effect.mac, password: effect.password });
        return [{ type: "PASSWORD_OK" }];
      } catch (err) {
        const code = parsePortalError(err);
        if (code === "WRONG_PASSWORD") return [{ type: "PASSWORD_WRONG" }];
        if (code === "RATE_LIMITED") return [{ type: "SHOW_RATELIMIT" }];
        // Network failure during the password check -> back to password w/ alert.
        return [{ type: "CONNECT_FAILED" }];
      }

    case "authorize":
      try {
        // Idempotent server-side; safe to re-run on a retry.
        await client.authorize({ mac: effect.mac, guestId: ctx.guestId ?? "" });
        return [{ type: "CONNECT_OK" }];
      } catch (err) {
        const code = parsePortalError(err);
        if (code === "RATE_LIMITED") return [{ type: "SHOW_RATELIMIT" }];
        // Anything else (network, transient) -> back to password with an alert.
        return [{ type: "CONNECT_FAILED" }];
      }

    case "resetAttempts":
      // Fire-and-forget: the back-navigation already transitioned the UI; a
      // failure here must never surface or throw.
      try {
        await client.resetAttempts({ mac: effect.mac });
      } catch {
        // swallow, best-effort server-side counter reset
      }
      return [];

    default:
      return [];
  }
}
