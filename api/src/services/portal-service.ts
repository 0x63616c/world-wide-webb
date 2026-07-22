/**
 * Captive-portal domain service (www-q002.9, password-only since www-p9hx).
 *
 * Pure flow logic for the guest WiFi onboarding at the LAN captive portal: the
 * guest types a single shared WiFi password, and on success the device is
 * authorized for 30 days via UniFi. There is NO email/OTP step: Apple's Captive
 * Network Assistant can't reach Mail pre-auth, so an emailed code is unusable in
 * the sheet (www-p9hx). The service depends on two INTERFACES, a PortalRepo
 * (data access) and a UnifiGuestClient, so the router wires the real
 * drizzle/UniFi adapters while tests inject in-memory fakes (no Postgres, no
 * network).
 *
 * Rate limiting is GLOBAL, not per-device: an open guest SSID lets an attacker
 * rotate MACs freely, so a per-MAC lock is meaningless. Instead the server caps
 * wrong password attempts at GLOBAL_MAX_WRONG_PER_DAY per UTC calendar day
 * (one DB counter). Against that cap even a short shared password is uncrackable
 * online. The DB is the source of truth for the 30-day authorization window
 * (mirrors the lights desired-state model); UniFi is the actuator and is healed
 * in the background when its grant drifts from the DB. Services THROW on
 * error/unconfigured, never return a fabricated success.
 */
import { getLogger } from "@www/logger";
import type { UnifiGuestClient } from "../integrations/unifi";

// ─── domain rows (repo contract; shaped like the drizzle rows the adapter returns)

export interface PortalRateLimitRow {
  id: string;
  dateUtc: string; // YYYY-MM-DD (UTC)
  wrongAttempts: number;
  updatedAtUtc: Date;
}

export interface PortalAuthorizationRow {
  id: string;
  mac: string;
  grantedAtUtc: Date;
  expiresAtUtc: Date;
}

/**
 * The data-access surface the service needs. The production adapter (in the
 * router) implements this over drizzle/Postgres; tests implement it in memory.
 */
export interface PortalRepo {
  /** The global rate-limit singleton, or null if no attempts have been recorded. */
  getRateLimit(): Promise<PortalRateLimitRow | null>;
  /**
   * Atomically record one wrong password attempt for the given UTC day and
   * return the resulting count for that day. If the stored row is from an
   * earlier day the counter resets to 1 (a new day's first wrong attempt).
   */
  bumpWrongAttempt(dateUtc: string, now: Date): Promise<number>;
  findAuthorizationByMac(mac: string): Promise<PortalAuthorizationRow | null>;
  upsertAuthorization(
    mac: string,
    grantedAtUtc: Date,
    expiresAtUtc: Date,
  ): Promise<PortalAuthorizationRow>;
}

// ─── typed errors ──────────────────────────────────────────────────────────

export const PortalErrorCode = {
  WrongPassword: "WRONG_PASSWORD",
  RateLimited: "RATE_LIMITED",
  NotConfigured: "NOT_CONFIGURED",
} as const;
export type PortalErrorCode = (typeof PortalErrorCode)[keyof typeof PortalErrorCode];

/** A typed, expected portal-flow failure (wrong password, lockout, …). */
export class PortalError extends Error {
  constructor(
    public readonly code: PortalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

// ─── constants ───────────────────────────────────────────────────────────────

// 1000 wrong password attempts per UTC day → RateLimited (www-p9hx). Online
// guessing is network-bound, not GPU-bound; this cap makes the shared password
// uncrackable in practice regardless of length.
const GLOBAL_MAX_WRONG_PER_DAY = 1000;
const AUTHORIZATION_MINUTES = 43200; // 30 days (PRD flow rule 5)
const AUTHORIZATION_MS = AUTHORIZATION_MINUTES * 60 * 1000;

// ─── inputs / outputs ──────────────────────────────────────────────────────

interface CheckPasswordInput {
  mac: string;
  password: string;
}
interface AuthorizeInput {
  mac: string;
  password: string;
}
interface StatusInput {
  mac: string;
}

type PortalStatusState = "fresh" | "active" | "expired";
interface PortalStatus {
  state: PortalStatusState;
}

export interface PortalServiceDeps {
  repo: PortalRepo;
  unifi: UnifiGuestClient;
  /** The op-delivered guest WiFi password; empty string when unconfigured. */
  wifiPassword: string;
  /** Injectable clock so tests drive expiry/day-rollover deterministically. */
  now?: () => Date;
}

/** The UTC calendar day (YYYY-MM-DD) the given instant falls in. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Constant-time-ish string compare to avoid leaking the WiFi password length /
 * prefix via timing. Not a cryptographic guarantee (LAN-only), but cheap and
 * correct in intent.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface PortalService {
  checkPassword(input: CheckPasswordInput): Promise<{ ok: true }>;
  authorize(input: AuthorizeInput): Promise<{ authorized: true }>;
  status(input: StatusInput): Promise<PortalStatus>;
}

export function createPortalService(deps: PortalServiceDeps): PortalService {
  const { repo, unifi, wifiPassword } = deps;
  const now = deps.now ?? (() => new Date());

  /** Wrong-attempt count already recorded for the current UTC day (0 across a rollover). */
  async function wrongCountToday(today: string): Promise<number> {
    const row = await repo.getRateLimit();
    return row && row.dateUtc === today ? row.wrongAttempts : 0;
  }

  /**
   * Verify the guest-supplied password against the configured WiFi password,
   * under the same global rate limit as checkPassword. Shared by every
   * procedure that must gate on the password (checkPassword, authorize) so
   * there is exactly one path that can grant access — authorize can never be
   * called with an unverified password.
   */
  async function verifyPassword(password: string): Promise<void> {
    if (!wifiPassword) {
      throw new PortalError(
        PortalErrorCode.NotConfigured,
        "WiFi password is not configured on the server.",
      );
    }
    const today = utcDay(now());
    if ((await wrongCountToday(today)) >= GLOBAL_MAX_WRONG_PER_DAY) {
      throw new PortalError(PortalErrorCode.RateLimited, "Too many attempts, try again later.");
    }
    if (!safeEqual(password, wifiPassword)) {
      const count = await repo.bumpWrongAttempt(today, now());
      if (count >= GLOBAL_MAX_WRONG_PER_DAY) {
        throw new PortalError(PortalErrorCode.RateLimited, "Too many attempts, try again later.");
      }
      throw new PortalError(PortalErrorCode.WrongPassword, "That password is not correct.");
    }
  }

  return {
    async checkPassword({ mac, password }) {
      await verifyPassword(password);
      getLogger().info({ mac }, "portal password accepted");
      return { ok: true };
    },

    async authorize({ mac, password }) {
      // Re-verify server-side: authorize must never be reachable without a
      // correct password, regardless of what the client claims to have
      // checked (any guest-SSID device can call this procedure directly).
      await verifyPassword(password);
      const current = now();
      const expiresAtUtc = new Date(current.getTime() + AUTHORIZATION_MS);
      // DB is the source of truth: upsert keeps exactly one row per mac (idempotent).
      await repo.upsertAuthorization(mac, current, expiresAtUtc);
      // Actuate on the controller. authorize-guest is idempotent controller-side.
      await unifi.authorizeGuest(mac, AUTHORIZATION_MINUTES);
      getLogger().info({ mac, expiresAtUtc }, "portal device authorized");
      return { authorized: true };
    },

    async status({ mac }) {
      const row = await repo.findAuthorizationByMac(mac);
      if (!row) return { state: "fresh" };
      if (row.expiresAtUtc.getTime() <= now().getTime()) return { state: "expired" };

      // Active in the DB. Reconcile the controller in the background: if it lost
      // the grant (reboot, flush) re-fire authorize-guest so an "Already online"
      // guest actually has internet, not just a screen. Best-effort, a UniFi
      // outage must not flip a healthy DB row to a worse UX, so we log and keep
      // reporting active (the DB is the source of truth).
      try {
        const controllerGrant = await unifi.findActiveAuthorization(mac);
        if (!controllerGrant) {
          await unifi.authorizeGuest(mac, AUTHORIZATION_MINUTES);
          getLogger().info({ mac }, "portal healed controller authorization");
        }
      } catch (err) {
        getLogger().warn(
          { err, mac },
          "portal controller reconcile failed (DB row still authoritative)",
        );
      }
      return { state: "active" };
    },
  };
}
