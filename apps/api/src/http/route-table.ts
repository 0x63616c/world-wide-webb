import type { HttpRoute } from "@app-kit";

/**
 * First-match route lookup with exact-before-prefix precedence (S3). Exact
 * matches are tried before any prefix, and among prefixes the LONGEST wins , so
 * a future broad prefix (e.g. "/media/") can never shadow a specific one
 * ("/media/booth-photos/") or an exact route. Method-gated: an undefined
 * route.method matches any method. Pure (no Request needed) so it unit-tests in
 * isolation.
 */
export function findRoute(
  routes: readonly HttpRoute[],
  method: string,
  pathname: string,
): HttpRoute | undefined {
  const methodOk = (r: HttpRoute) => r.method === undefined || r.method === method;
  const exact = routes.find(
    (r) => (r.match ?? "exact") === "exact" && r.path === pathname && methodOk(r),
  );
  if (exact) return exact;
  let best: HttpRoute | undefined;
  for (const r of routes) {
    if (r.match !== "prefix" || !pathname.startsWith(r.path) || !methodOk(r)) continue;
    if (!best || r.path.length > best.path.length) best = r;
  }
  return best;
}
