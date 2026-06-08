// Dependency-injected Cloudflare route client so tests mock without real API calls.
export interface CloudflareRouteClient {
  listRoutes(): Promise<Array<{ id: string; hostname: string; tags: string[] }>>;
  createRoute(hostname: string, tag: string): Promise<{ id: string }>;
  deleteRoute(id: string): Promise<void>;
}

// Tag format used to identify routes owned by a specific bosun stack.
// Only routes carrying this exact tag are eligible for prune — anything else
// is foreign and must not be touched.
export function stackRouteTag(stackName: string): string {
  return `bosun:${stackName}`;
}

// Extract the origin service name from a tunnel ingress `service` value.
// "http://web:80" -> "web"; "http_status:404" / non-http -> "" (not a service).
// Ownership is derived from this: a route whose origin points at one of THIS
// stack's swarm services is stack-owned (CF ingress carries no native tag field,
// so origin is the only durable ownership signal).
function originServiceName(service: string): string {
  const m = service.match(/^https?:\/\/([^:/]+)/);
  return m ? m[1] : "";
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

// --- DNS reconcile ----------------------------------------------------------
//
// An ingress rule alone is not enough to reach a service: the public hostname
// also needs a proxied DNS CNAME pointing at the tunnel (`<tunnelId>.cfargotunnel.com`).
// The zone's wildcard `*.worldwidewebb.co` is a dead A-record, NOT the tunnel,
// so a hostname without its own CNAME 521s even when the ingress rule exists
// (this is exactly what bit the `drizzle` service). bosun must upsert that CNAME.

// Dependency-injected Cloudflare DNS client so tests mock without real API calls.
export interface CloudflareDnsClient {
  // List CNAME records in the zone (id, hostname, content = CNAME target).
  listCnames(): Promise<Array<{ id: string; hostname: string; content: string }>>;
  // Create a proxied CNAME <hostname> -> <target>.
  createCname(hostname: string, target: string): Promise<{ id: string }>;
  deleteCname(id: string): Promise<void>;
}

// The CNAME target every tunnel-routed hostname points at.
export function tunnelCnameTarget(tunnelId: string): string {
  return `${tunnelId}.cfargotunnel.com`;
}

// Reconcile public DNS CNAMEs for tunnel-routed hostnames:
//   1. Create a proxied CNAME <hostname> -> <tunnel target> for each declared
//      hostname that has no matching record yet.
//   2. Prune ONLY records that (a) point at OUR tunnel target AND (b) are in the
//      `ownedHostnames` set (the stack's own ingress routes) AND (c) are no
//      longer declared. A foreign hostname that happens to share the tunnel
//      target (e.g. `portainer`, a foreign ingress route) is NEVER in
//      `ownedHostnames`, so it is never pruned. Records pointing elsewhere are
//      ignored entirely.
export async function reconcileDns(
  declaredHostnames: string[],
  tunnelTarget: string,
  client: CloudflareDnsClient,
  ownedHostnames: Iterable<string> = [],
): Promise<void> {
  const existing = await client.listCnames();
  const existingByHostname = new Map(existing.map((r) => [r.hostname, r]));

  // Create a CNAME for each declared hostname that is missing one. If a record
  // exists but points elsewhere we leave it alone — overwriting a foreign target
  // is out of scope and unsafe; ingress is the durable signal anyway.
  for (const hostname of declaredHostnames) {
    if (!existingByHostname.has(hostname)) {
      await client.createCname(hostname, tunnelTarget);
    }
  }

  // Prune only stack-owned tunnel CNAMEs that are no longer declared.
  const declaredSet = new Set(declaredHostnames);
  const ownedSet = new Set(ownedHostnames);
  for (const record of existing) {
    const isTunnelCname = record.content === tunnelTarget;
    const isOurs = ownedSet.has(record.hostname);
    if (isTunnelCname && isOurs && !declaredSet.has(record.hostname)) {
      await client.deleteCname(record.id);
    }
  }
}

// Default Cloudflare DNS client using the zone DNS-records API. Proxied (orange
// cloud) is required — a grey-cloud CNAME to `<tunnel>.cfargotunnel.com` does not
// resolve. The token is resolved by the caller from 1Password — never stored here.
export function makeDefaultCloudflareDnsClient(
  zoneId: string,
  apiToken: string,
): CloudflareDnsClient {
  const baseUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  return {
    async listCnames() {
      // per_page max is 100; the zone has a handful of records, so one page is
      // plenty. Filter to CNAMEs server-side.
      const res = await fetch(`${baseUrl}?type=CNAME&per_page=100`, { headers });
      if (!res.ok) throw new Error(`CF DNS API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        result?: Array<{ id: string; name: string; content: string }>;
      };
      return (data.result ?? []).map((r) => ({
        id: r.id,
        hostname: r.name,
        content: r.content,
      }));
    },

    async createCname(hostname: string, target: string) {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "CNAME",
          name: hostname,
          content: target,
          proxied: true,
          ttl: 1, // 1 = automatic; required/ignored for proxied records.
        }),
      });
      if (!res.ok) throw new Error(`CF DNS API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { result?: { id?: string } };
      return { id: data.result?.id ?? hostname };
    },

    async deleteCname(id: string) {
      const res = await fetch(`${baseUrl}/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(`CF DNS API error ${res.status}: ${await res.text()}`);
    },
  };
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
// endpoint, and ingress rules carry no native tag/metadata field. Route ownership
// for safe prune is therefore derived from the rule's ORIGIN: a route pointing at
// one of this stack's swarm services (`ownership.stackServiceNames`) is tagged with
// `ownership.stackTag`, so reconcileRoutes can prune a stack-owned orphan while
// foreign hostnames (e.g. portainer → http://portainer:9000) carry no tag and are
// never touched. Omit `ownership` to disable prune entirely (listRoutes returns
// empty tags). Creation needs the origin service for a hostname, supplied by
// `originForHostname` (built from the spec by the caller).
export function makeDefaultCloudflareRouteClient(
  accountId: string,
  tunnelId: string,
  apiToken: string,
  originForHostname: (hostname: string) => string,
  ownership?: { stackTag: string; stackServiceNames: string[] },
): CloudflareRouteClient {
  const ownedServiceNames = new Set(ownership?.stackServiceNames ?? []);
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
      // Tag a route as stack-owned iff its origin points at one of this stack's
      // services — the only durable ownership signal CF ingress exposes.
      return ingress
        .filter((r): r is IngressRule & { hostname: string } => Boolean(r.hostname))
        .map((r) => {
          const tag =
            ownership && ownedServiceNames.has(originServiceName(r.service))
              ? ownership.stackTag
              : undefined;
          return { id: r.hostname, hostname: r.hostname, tags: tag ? [tag] : [] };
        });
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
