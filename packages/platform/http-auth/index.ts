import { createHash, timingSafeEqual } from "node:crypto";

/** Scoped machine endpoints fail closed when their optional token is unset.
 * Compare fixed-size digests, and never echo credentials in errors or logs. */
export function matchesBearer(request: Request, token: string | undefined): boolean {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied.slice(7)), digest(token));
}
