import { timingSafeEqual } from "node:crypto";

/** Scoped machine endpoints fail closed when their optional token is unset.
 * Compare equal-length raw bearer secrets in constant time, and never echo
 * credentials in errors or logs.
 */
export function matchesBearer(request: Request, token: string | undefined): boolean {
  if (!token || token.length < 32) return false;
  const supplied = request.headers.get("authorization");
  if (!supplied?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(supplied.slice(7));
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
