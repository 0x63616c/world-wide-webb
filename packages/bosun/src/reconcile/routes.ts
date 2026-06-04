// Dependency-injected Cloudflare route client so tests mock without real API calls.
export interface CloudflareRouteClient {
  listRoutes(): Promise<Array<{ id: string; hostname: string; tags: string[] }>>;
  createRoute(hostname: string, tag: string): Promise<{ id: string }>;
  deleteRoute(id: string): Promise<void>;
}

// Tag format used to identify routes owned by a specific bosun stack.
// Only routes carrying this exact tag are eligible for prune — anything else
// is foreign and must not be touched.
function stackRouteTag(stackName: string): string {
  return `bosun:${stackName}`;
}

// Reconcile Cloudflare public-hostname routes:
//   1. Create declared hostnames that don't exist yet, tagged for this stack.
//   2. Prune only routes tagged for THIS stack that are no longer declared.
// Foreign routes (no tag or a different stack's tag) are never deleted.
export async function reconcileRoutes(
  stackName: string,
  declaredHostnames: string[],
  client: CloudflareRouteClient,
): Promise<void> {
  const tag = stackRouteTag(stackName);
  const existing = await client.listRoutes();

  const existingByHostname = new Map(existing.map((r) => [r.hostname, r]));

  // Create routes that are declared but not yet present.
  for (const hostname of declaredHostnames) {
    if (!existingByHostname.has(hostname)) {
      await client.createRoute(hostname, tag);
    }
  }

  // Prune only stack-owned routes that are no longer declared.
  const declaredSet = new Set(declaredHostnames);
  for (const route of existing) {
    const isOurs = route.tags.includes(tag);
    if (isOurs && !declaredSet.has(route.hostname)) {
      await client.deleteRoute(route.id);
    }
  }
}

// A single Cloudflare tunnel ingress rule. The last rule has no hostname (the
// catch-all, e.g. { service: "http_status:404" }); all others route a hostname
// to an origin like "http://web:80".
interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
  originRequest?: unknown;
}

// Default Cloudflare client implementation using the CF API directly.
// The token is resolved by the caller from 1Password — never stored here.
//
// CF tunnel routes are managed as one document: you GET the full configuration,
// mutate the ingress array, and PUT it back. There is no per-rule create/delete
// endpoint, and ingress rules carry no native tag/metadata field — so route
// ownership for prune cannot be derived from CF and listRoutes returns empty
// tags (reconcileRoutes therefore never auto-prunes a live route; foreign-route
// safety is preserved by construction). Creation needs the origin service for a
// hostname, supplied by `originForHostname` (built from the spec by the caller).
export function makeDefaultCloudflareRouteClient(
  accountId: string,
  tunnelId: string,
  apiToken: string,
  originForHostname: (hostname: string) => string,
): CloudflareRouteClient {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  async function getIngress(): Promise<IngressRule[]> {
    const res = await fetch(baseUrl, { headers });
    if (!res.ok) throw new Error(`CF API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { result?: { config?: { ingress?: IngressRule[] } } };
    return data.result?.config?.ingress ?? [];
  }

  async function putIngress(ingress: IngressRule[]): Promise<void> {
    const res = await fetch(baseUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ config: { ingress } }),
    });
    if (!res.ok) throw new Error(`CF API error ${res.status}: ${await res.text()}`);
  }

  return {
    async listRoutes() {
      const ingress = await getIngress();
      // Each ingress rule without a hostname is the catch-all — skip it. The
      // hostname is the stable id (hostnames are unique within a tunnel config).
      return ingress
        .filter((r): r is IngressRule & { hostname: string } => Boolean(r.hostname))
        .map((r) => ({ id: r.hostname, hostname: r.hostname, tags: [] }));
    },

    async createRoute(hostname: string, _tag: string) {
      const ingress = await getIngress();
      // Idempotent: if the hostname already routes somewhere, leave it alone.
      if (ingress.some((r) => r.hostname === hostname)) return { id: hostname };

      const service = originForHostname(hostname);
      if (!service) {
        throw new Error(`createRoute: no origin service known for hostname '${hostname}'`);
      }

      // Insert before the catch-all (the trailing rule with no hostname) so the
      // new hostname rule is matched and the catch-all stays last.
      const rule: IngressRule = { hostname, service };
      const catchAllIdx = ingress.findIndex((r) => !r.hostname);
      if (catchAllIdx === -1) ingress.push(rule);
      else ingress.splice(catchAllIdx, 0, rule);

      await putIngress(ingress);
      return { id: hostname };
    },

    async deleteRoute(id: string) {
      const ingress = await getIngress();
      // id is the hostname (from listRoutes/createRoute). The catch-all has no
      // hostname, so `hostname !== id` keeps it; only the matching rule is dropped.
      const next = ingress.filter((r) => r.hostname !== id);
      if (next.length === ingress.length) return; // nothing matched
      await putIngress(next);
    },
  };
}
