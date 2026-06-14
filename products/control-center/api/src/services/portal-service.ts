/**
 * Captive-portal domain service (www-q002.9).
 *
 * Pure flow logic for the guest WiFi onboarding at captive-portal.worldwidewebb.co:
 * send a 6-digit email code, verify it, check the WiFi password, report device
 * status, and authorize the device for 30 days via UniFi. The service depends on
 * three INTERFACES, a PortalRepo (data access), an EmailSender, and a
 * UnifiGuestClient, so the router wires the real drizzle/Resend/UniFi adapters
 * while tests inject in-memory fakes with no Postgres and no network.
 *
 * Rate-limit + cooldown are enforced HERE (server-side), never trusted to the UI:
 * 3 wrong codes OR 3 wrong passwords lock the device (keyed by MAC); the 30s
 * resend cooldown is keyed by email. The DB is the source of truth for the 30-day
 * authorization window (mirrors the lights desired-state model); UniFi is the
 * actuator and is healed in the background when its grant drifts from the DB.
 * Services THROW on error/unconfigured, never return a fabricated success.
 */
import { randomInt } from "node:crypto";
import { getLogger } from "@repo/logger";
import type { UnifiGuestClient } from "../integrations/unifi";

// ─── domain rows (repo contract; shaped like the drizzle rows the adapter returns)

export interface PortalGuestRow {
  id: string;
  name: string;
  email: string;
  createdAtUtc: Date;
}

export interface PortalCodeRow {
  id: string;
  guestId: string;
  code: string;
  consumed: boolean;
  expiresAtUtc: Date;
  createdAtUtc: Date;
}

export interface PortalAttemptRow {
  mac: string;
  kind: string;
  wrongCount: number;
  lockedUntilUtc: Date | null;
}

export interface PortalAuthorizationRow {
  id: string;
  mac: string;
  guestId: string;
  grantedAtUtc: Date;
  expiresAtUtc: Date;
}

/**
 * The data-access surface the service needs. The production adapter (in the
 * router) implements this over drizzle/Postgres; tests implement it in memory.
 */
export interface PortalRepo {
  createGuest(name: string, email: string, now: Date): Promise<PortalGuestRow>;
  newestGuestByEmail(email: string): Promise<PortalGuestRow | null>;
  newestUnconsumedCodeForGuest(guestId: string): Promise<PortalCodeRow | null>;
  consumeCodesForGuest(guestId: string): Promise<void>;
  createCode(guestId: string, code: string, expiresAtUtc: Date, now: Date): Promise<PortalCodeRow>;
  markCodeConsumed(codeId: string): Promise<void>;
  getAttempt(mac: string, kind: AttemptKind): Promise<PortalAttemptRow | null>;
  upsertAttempt(
    mac: string,
    kind: AttemptKind,
    wrongCount: number,
    lockedUntilUtc: Date | null,
  ): Promise<void>;
  clearAttempt(mac: string, kind: AttemptKind): Promise<void>;
  findAuthorizationByMac(mac: string): Promise<PortalAuthorizationRow | null>;
  upsertAuthorization(
    mac: string,
    guestId: string,
    grantedAtUtc: Date,
    expiresAtUtc: Date,
  ): Promise<PortalAuthorizationRow>;
}

/** Sends the verification code to the guest. The router picks Resend vs mock. */
export interface EmailSender {
  sendCode(email: string, code: string): Promise<void>;
}

// ─── typed errors ──────────────────────────────────────────────────────────

export const PortalErrorCode = {
  WrongCode: "WRONG_CODE",
  ExpiredCode: "EXPIRED_CODE",
  WrongPassword: "WRONG_PASSWORD",
  RateLimited: "RATE_LIMITED",
  ResendCooldown: "RESEND_COOLDOWN",
  NotConfigured: "NOT_CONFIGURED",
  NoActiveCode: "NO_ACTIVE_CODE",
} as const;
export type PortalErrorCode = (typeof PortalErrorCode)[keyof typeof PortalErrorCode];

/** A typed, expected portal-flow failure (wrong code, lockout, …). */
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

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes (PRD flow rule 3)
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds (PRD flow rule 4)
const MAX_WRONG = 3; // 3 wrong attempts → RateLimited (PRD flow rule 2)
const AUTHORIZATION_MINUTES = 43200; // 30 days (PRD flow rule 5)
const AUTHORIZATION_MS = AUTHORIZATION_MINUTES * 60 * 1000;

type AttemptKind = "code" | "password";

// ─── inputs / outputs ──────────────────────────────────────────────────────

interface SendCodeInput {
  mac: string;
  name: string;
  email: string;
}
interface VerifyCodeInput {
  mac: string;
  email: string;
  code: string;
}
interface CheckPasswordInput {
  mac: string;
  password: string;
}
interface AuthorizeInput {
  mac: string;
  guestId: string;
}
interface StatusInput {
  mac: string;
}
interface ResetAttemptsInput {
  mac: string;
}

type PortalStatusState = "fresh" | "active" | "expired";
interface PortalStatus {
  state: PortalStatusState;
}

export interface PortalServiceDeps {
  repo: PortalRepo;
  sender: EmailSender;
  unifi: UnifiGuestClient;
  /** The op-delivered guest WiFi password; empty string when unconfigured. */
  wifiPassword: string;
  /** Injectable clock so tests drive cooldown/expiry deterministically. */
  now?: () => Date;
}

/** Six digits, uniformly random, leading zeros preserved. */
function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
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
  sendCode(input: SendCodeInput): Promise<{ cooldownSeconds: number }>;
  verifyCode(input: VerifyCodeInput): Promise<{ verified: true; guestId: string }>;
  checkPassword(input: CheckPasswordInput): Promise<{ ok: true }>;
  authorize(input: AuthorizeInput): Promise<{ authorized: true }>;
  status(input: StatusInput): Promise<PortalStatus>;
  /**
   * Clear a device's wrong-code AND wrong-password counters, the server side of
   * the UI "back" action (PRD flow rule 2: counters reset on success/back/resend).
   * Idempotent: clearing an absent counter is a no-op.
   */
  resetAttempts(input: ResetAttemptsInput): Promise<{ reset: true }>;
}

export function createPortalService(deps: PortalServiceDeps): PortalService {
  const { repo, sender, unifi, wifiPassword } = deps;
  const now = deps.now ?? (() => new Date());

  /** Throw RateLimited if the device is currently locked for this kind. */
  async function assertNotLocked(mac: string, kind: AttemptKind): Promise<PortalAttemptRow | null> {
    const attempt = await repo.getAttempt(mac, kind);
    if (attempt?.lockedUntilUtc && attempt.lockedUntilUtc.getTime() > now().getTime()) {
      throw new PortalError(PortalErrorCode.RateLimited, "Too many attempts, try again later.");
    }
    return attempt;
  }

  /** Record a wrong attempt; lock the device once it reaches MAX_WRONG. */
  async function recordWrong(
    mac: string,
    kind: AttemptKind,
    prior: PortalAttemptRow | null,
  ): Promise<boolean> {
    const wrongCount = (prior?.wrongCount ?? 0) + 1;
    const locked = wrongCount >= MAX_WRONG;
    // Lock window mirrors the code TTL so a locked device can retry after it lapses.
    const lockedUntilUtc = locked ? new Date(now().getTime() + CODE_TTL_MS) : null;
    await repo.upsertAttempt(mac, kind, wrongCount, lockedUntilUtc);
    return locked;
  }

  return {
    async sendCode({ mac, name, email }) {
      // 30s resend cooldown, keyed by email (the newest code's age).
      const existingGuest = await repo.newestGuestByEmail(email);
      if (existingGuest) {
        const newest = await repo.newestUnconsumedCodeForGuest(existingGuest.id);
        if (newest && now().getTime() - newest.createdAtUtc.getTime() < RESEND_COOLDOWN_MS) {
          throw new PortalError(
            PortalErrorCode.ResendCooldown,
            "Please wait before requesting another code.",
          );
        }
      }

      const guest = existingGuest ?? (await repo.createGuest(name, email, now()));
      // One live code per guest: supersede any prior unconsumed codes.
      await repo.consumeCodesForGuest(guest.id);
      const code = generateCode();
      await repo.createCode(guest.id, code, new Date(now().getTime() + CODE_TTL_MS), now());
      await sender.sendCode(email, code);
      // The mac is the rate-limit unit; clear any prior code-attempt lock on a fresh send.
      await repo.clearAttempt(mac, "code");
      getLogger().info({ mac, guestId: guest.id }, "portal code sent");
      return { cooldownSeconds: RESEND_COOLDOWN_MS / 1000 };
    },

    async verifyCode({ mac, email, code }) {
      const prior = await assertNotLocked(mac, "code");
      const guest = await repo.newestGuestByEmail(email);
      const active = guest ? await repo.newestUnconsumedCodeForGuest(guest.id) : null;

      // Expired is a DISTINCT path from wrong (PRD flow rule 3): a live unconsumed
      // code that has passed its TTL → ExpiredCode, not WrongCode.
      if (active && active.expiresAtUtc.getTime() <= now().getTime()) {
        await repo.markCodeConsumed(active.id);
        throw new PortalError(PortalErrorCode.ExpiredCode, "That code has expired.");
      }

      if (!active || !safeEqual(active.code, code)) {
        const locked = await recordWrong(mac, "code", prior);
        if (locked) {
          throw new PortalError(PortalErrorCode.RateLimited, "Too many attempts, try again later.");
        }
        throw new PortalError(PortalErrorCode.WrongCode, "That code is not correct.");
      }

      await repo.markCodeConsumed(active.id);
      await repo.clearAttempt(mac, "code");
      // guest is non-null here because `active` (derived from it) exists.
      const guestId = guest?.id ?? active.guestId;
      getLogger().info({ mac, guestId }, "portal code verified");
      return { verified: true, guestId };
    },

    async checkPassword({ mac, password }) {
      if (!wifiPassword) {
        throw new PortalError(
          PortalErrorCode.NotConfigured,
          "WiFi password is not configured on the server.",
        );
      }
      const prior = await assertNotLocked(mac, "password");
      if (!safeEqual(password, wifiPassword)) {
        const locked = await recordWrong(mac, "password", prior);
        if (locked) {
          throw new PortalError(PortalErrorCode.RateLimited, "Too many attempts, try again later.");
        }
        throw new PortalError(PortalErrorCode.WrongPassword, "That password is not correct.");
      }
      await repo.clearAttempt(mac, "password");
      return { ok: true };
    },

    async authorize({ mac, guestId }) {
      const current = now();
      const expiresAtUtc = new Date(current.getTime() + AUTHORIZATION_MS);
      // DB is the source of truth: upsert keeps exactly one row per mac (idempotent).
      await repo.upsertAuthorization(mac, guestId, current, expiresAtUtc);
      // Actuate on the controller. authorize-guest is idempotent controller-side.
      await unifi.authorizeGuest(mac, AUTHORIZATION_MINUTES);
      getLogger().info({ mac, guestId, expiresAtUtc }, "portal device authorized");
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

    async resetAttempts({ mac }) {
      // The UI "back" action resets the rate-limit counters for this device, so a
      // guest who backed out of the code or password step starts that step fresh.
      await repo.clearAttempt(mac, "code");
      await repo.clearAttempt(mac, "password");
      return { reset: true };
    },
  };
}
