import { createHash, timingSafeEqual } from "node:crypto";

/** Scoped machine endpoints fail closed when their optional token is unset.
 * Compare fixed-size digests, and never echo credentials in errors or logs.
 *
 * SHA-256 here is only for constant-time equality of high-entropy API bearer
 * tokens (not password storage / cracking resistance).
 */
export function matchesBearer(request: Request, token: string | undefined): boolean {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;
  // codeql[js/insufficient-password-hash]: comparing high-entropy API bearer tokens, not hashing passwords for storage
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied.slice(7)), digest(token));
}
