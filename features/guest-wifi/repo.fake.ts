/**
 * In-memory PortalRepo for service tests (www-q002.9, password-only since
 * www-p9hx). Honours the same contract as the drizzle-backed repo the router
 * wires in production, with no Postgres. Kept in __tests__ so it never ships in
 * the bundle.
 */
import type { PortalAuthorizationRow, PortalRateLimitRow, PortalRepo } from "./service";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(16).padStart(8, "0")}`;

export function makeInMemoryPortalRepo(): PortalRepo & {
  findAuthorization: (mac: string) => PortalAuthorizationRow | undefined;
  authorizationCount: (mac: string) => number;
  wrongAttemptsToday: () => number;
} {
  const auths: PortalAuthorizationRow[] = [];
  let rateLimit: PortalRateLimitRow | null = null;

  return {
    async getRateLimit() {
      return rateLimit;
    },
    async bumpWrongAttempt(dateUtc, now) {
      const next = rateLimit && rateLimit.dateUtc === dateUtc ? rateLimit.wrongAttempts + 1 : 1;
      rateLimit = { id: "global", dateUtc, wrongAttempts: next, updatedAtUtc: now };
      return next;
    },
    async findAuthorizationByMac(mac) {
      return auths.find((a) => a.mac === mac) ?? null;
    },
    async upsertAuthorization(mac, grantedAtUtc, expiresAtUtc) {
      const existing = auths.find((a) => a.mac === mac);
      if (existing) {
        existing.grantedAtUtc = grantedAtUtc;
        existing.expiresAtUtc = expiresAtUtc;
        return existing;
      }
      const row: PortalAuthorizationRow = { id: id("auth"), mac, grantedAtUtc, expiresAtUtc };
      auths.push(row);
      return row;
    },
    findAuthorization: (mac) => auths.find((a) => a.mac === mac),
    authorizationCount: (mac) => auths.filter((a) => a.mac === mac).length,
    wrongAttemptsToday: () => rateLimit?.wrongAttempts ?? 0,
  };
}
