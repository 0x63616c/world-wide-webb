// Effect runner: executes a PortalEffect against the tRPC portal client and maps
// the result (or a typed PortalError) onto the FlowEvent(s) to dispatch. The
// reducer emits effects; this runs them. Pure mapping over an injectable client,
// so every effect->event path is unit tested with a mock (no network).
// Password-only since www-p9hx (no sendCode/verifyCode/resetAttempts).
import type { FlowEvent, PortalEffect } from "./flow";

// The slice of the portal router this runner calls. The real client (typed via
// GuestRouter, src/portal/lib/trpc.ts) structurally satisfies this; tests inject a mock.
export interface PortalClient {
  checkPassword(input: { mac: string; password: string }): Promise<{ ok: true }>;
  authorize(input: { mac: string; password: string }): Promise<{ authorized: true }>;
  status(input: { mac: string }): Promise<{ state: "fresh" | "active" | "expired" }>;
}

// The typed portal codes the backend exposes. Preferred channel is the
// structural `error.data.portalCode` (errorFormatter); the "CODE: message"
// prefix parse is a transitional fallback.
type PortalCode = "WRONG_PASSWORD" | "RATE_LIMITED" | "NOT_CONFIGURED";

const KNOWN_CODES: ReadonlySet<string> = new Set<PortalCode>([
  "WRONG_PASSWORD",
  "RATE_LIMITED",
  "NOT_CONFIGURED",
]);

/** Extract the typed portal code from a thrown error, or null if it's an
 *  untyped (e.g. network) failure. Prefers structural data.portalCode; falls
 *  back to the "CODE: message" prefix the router formats. */
function parsePortalError(err: unknown): PortalCode | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: { portalCode?: unknown } }).data;
  if (data && typeof data.portalCode === "string" && KNOWN_CODES.has(data.portalCode)) {
    return data.portalCode as PortalCode;
  }
  const msg = (err as { message?: unknown }).message;
  if (typeof msg === "string") {
    const head = msg.split(":", 1)[0]?.trim();
    if (head && KNOWN_CODES.has(head)) return head as PortalCode;
  }
  return null;
}

/** Boot status -> the screen short-circuit event (or null = stay on password). */
export function statusToEvent(state: "fresh" | "active" | "expired"): FlowEvent | null {
  if (state === "active") return { type: "SHOW_ALREADY_CONNECTED" };
  if (state === "expired") return { type: "SHOW_SESSION_EXPIRED" };
  return null;
}

export async function runEffect(client: PortalClient, effect: PortalEffect): Promise<FlowEvent[]> {
  switch (effect.type) {
    case "checkPassword":
      try {
        await client.checkPassword({ mac: effect.mac, password: effect.password });
        return [{ type: "PASSWORD_OK" }];
      } catch (err) {
        const code = parsePortalError(err);
        if (code === "WRONG_PASSWORD") return [{ type: "PASSWORD_WRONG" }];
        if (code === "RATE_LIMITED") return [{ type: "SHOW_RATELIMIT" }];
        if (code === "NOT_CONFIGURED") return [{ type: "SHOW_ERROR" }];
        // Network failure during the password check -> back to password w/ alert.
        return [{ type: "CONNECT_FAILED" }];
      }

    case "authorize":
      try {
        // Idempotent server-side; safe to re-run on a retry. The server
        // re-verifies the password itself (never trusts a prior checkPassword
        // call), so it rides along on every authorize attempt.
        await client.authorize({ mac: effect.mac, password: effect.password });
        return [{ type: "CONNECT_OK" }];
      } catch (err) {
        const code = parsePortalError(err);
        if (code === "RATE_LIMITED") return [{ type: "SHOW_RATELIMIT" }];
        // Anything else (network, transient) -> back to password with an alert.
        return [{ type: "CONNECT_FAILED" }];
      }

    default:
      return [];
  }
}
