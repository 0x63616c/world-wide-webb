/**
 * In-memory PortalRepo for service tests (CC-q002.9). Honours the same contract
 * as the drizzle-backed repo the router wires in production, with no Postgres.
 * Kept in __tests__ so it never ships in the bundle.
 */
import type {
  PortalAuthorizationRow,
  PortalCodeRow,
  PortalGuestRow,
  PortalRepo,
} from "../../services/portal-service";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(16).padStart(8, "0")}`;

export function makeInMemoryPortalRepo(): PortalRepo & {
  firstGuestId: () => string;
  findAuthorization: (mac: string) => PortalAuthorizationRow | undefined;
  authorizationCount: (mac: string) => number;
} {
  const guests: PortalGuestRow[] = [];
  const codes: PortalCodeRow[] = [];
  const auths: PortalAuthorizationRow[] = [];
  const attempts = new Map<
    string,
    { mac: string; kind: string; wrongCount: number; lockedUntilUtc: Date | null }
  >();

  return {
    async createGuest(name, email, now) {
      const row: PortalGuestRow = { id: id("gst"), name, email, createdAtUtc: now };
      guests.push(row);
      return row;
    },
    async newestUnconsumedCodeForGuest(guestId) {
      return (
        codes
          .filter((c) => c.guestId === guestId && !c.consumed)
          .sort((a, b) => b.createdAtUtc.getTime() - a.createdAtUtc.getTime())[0] ?? null
      );
    },
    async consumeCodesForGuest(guestId) {
      for (const c of codes) if (c.guestId === guestId) c.consumed = true;
    },
    async createCode(guestId, code, expiresAtUtc, now) {
      const row: PortalCodeRow = {
        id: id("otp"),
        guestId,
        code,
        consumed: false,
        expiresAtUtc,
        createdAtUtc: now,
      };
      codes.push(row);
      return row;
    },
    async newestGuestByEmail(email) {
      return (
        guests
          .filter((g) => g.email === email)
          .sort((a, b) => b.createdAtUtc.getTime() - a.createdAtUtc.getTime())[0] ?? null
      );
    },
    async markCodeConsumed(codeId) {
      const c = codes.find((c) => c.id === codeId);
      if (c) c.consumed = true;
    },
    async getAttempt(mac, kind) {
      return attempts.get(`${mac}:${kind}`) ?? null;
    },
    async upsertAttempt(mac, kind, wrongCount, lockedUntilUtc) {
      attempts.set(`${mac}:${kind}`, { mac, kind, wrongCount, lockedUntilUtc });
    },
    async clearAttempt(mac, kind) {
      attempts.delete(`${mac}:${kind}`);
    },
    async findAuthorizationByMac(mac) {
      return auths.find((a) => a.mac === mac) ?? null;
    },
    async upsertAuthorization(mac, guestId, grantedAtUtc, expiresAtUtc) {
      const existing = auths.find((a) => a.mac === mac);
      if (existing) {
        existing.guestId = guestId;
        existing.grantedAtUtc = grantedAtUtc;
        existing.expiresAtUtc = expiresAtUtc;
        return existing;
      }
      const row: PortalAuthorizationRow = {
        id: id("auth"),
        mac,
        guestId,
        grantedAtUtc,
        expiresAtUtc,
      };
      auths.push(row);
      return row;
    },
    firstGuestId: () => guests[0].id,
    findAuthorization: (mac) => auths.find((a) => a.mac === mac),
    authorizationCount: (mac) => auths.filter((a) => a.mac === mac).length,
  };
}
