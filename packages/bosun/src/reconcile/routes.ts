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

// Default Cloudflare client implementation using the CF API directly.
// The token is resolved by the caller from 1Password — never stored here.
export function makeDefaultCloudflareRouteClient(
  accountId: string,
  tunnelId: string,
  apiToken: string,
): CloudflareRouteClient {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  return {
    async listRoutes() {
      const res = await fetch(baseUrl, { headers });
      if (!res.ok) throw new Error(`CF API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        result: { config: { ingress: Array<{ hostname?: string; originRequest?: unknown }> } };
      };
      const ingress = data.result?.config?.ingress ?? [];
      // Each ingress rule without a hostname is the catch-all — skip it.
      return ingress
        .filter((r): r is { hostname: string; originRequest?: unknown } => Boolean(r.hostname))
        .map((r, i) => ({
          id: String(i),
          hostname: r.hostname,
          // CF tunnel ingress doesn't have native tags; we store ours in originRequest metadata.
          // For now return empty — live sync will need a side-channel or naming convention.
          tags: [],
        }));
    },

    async createRoute(_hostname: string, _tag: string) {
      // PUT the full config is required for CF tunnel routes; this is a simplified
      // version that appends — a real implementation must GET + merge + PUT.
      throw new Error(
        `createRoute not yet implemented for live CF client — use bosun routes sync from the CLI`,
      );
    },

    async deleteRoute(_id: string) {
      throw new Error(
        `deleteRoute not yet implemented for live CF client — use bosun routes sync from the CLI`,
      );
    },
  };
}
