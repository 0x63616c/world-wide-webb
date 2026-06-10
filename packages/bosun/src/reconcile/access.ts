// Cloudflare Access reconcile (www-cuuw) — the edge auth gate for *.worldwidewebb.co.
//
// A sibling of reconcile/routes.ts: it lists Access apps, creates the declared
// apps + their policy, and prunes ONLY apps it owns (tag-scoped), never touching
// a foreign app. Service tokens are READ-ONLY here (name -> CF id resolution for
// a service_auth policy); they are created out-of-band by scripts/save-cf-access-tokens.sh
// and are NEVER created or deleted by this reconcile (deleting a token instantly
// bricks whatever holds it; a stale token is harmless).
//
// All decision logic is pure; the CF I/O is behind the injected CloudflareAccessClient
// so tests use a fake and never hit the network (the routes.ts contract).

import type { AccessSpec } from "../spec.ts";

// A Cloudflare Access policy as the client models it. `decision` mirrors the CF
// API enum; `include` carries the OR-ed principal rules. We keep this minimal —
// only the shapes reconcileAccess produces and reads back.
/** @public — part of the CloudflareAccessClient contract (createApp/updateAppPolicy params), www-cuuw */
export interface AccessPolicy {
  decision: "allow" | "block" | "service_auth";
  include: AccessIncludeRule[];
}

// An include rule in CF's wire shape. `everyone` is CF's "Everyone" selector
// (used by the deny-all floor); `email` and `service_token` carry a principal.
/** @public — part of the CloudflareAccessClient contract (AccessPolicy.include), www-cuuw */
export type AccessIncludeRule =
  | { everyone: Record<string, never> }
  | { email: { email: string } }
  | { service_token: { token_id: string } };

// A live Access application as listed/created. `tags` is CF-native (unlike tunnel
// ingress), so ownership for safe prune is tag-based — no origin-name heuristic.
export interface AccessApp {
  id: string;
  // The single hostname or wildcard this app gates (e.g. "dashboard.worldwidewebb.co"
  // or "*.worldwidewebb.co"). CF apps can carry multiple domains; we manage one.
  domain: string;
  tags: string[];
}

// A desired app: the domain to gate plus the AccessSpec that maps to its policy.
export interface DesiredAccessApp {
  domain: string;
  access: AccessSpec;
}

// Dependency-injected Cloudflare Access client so tests mock without real API calls.
export interface CloudflareAccessClient {
  listApps(): Promise<AccessApp[]>;
  // Create an app for `domain` (tagged) with its single policy.
  createApp(domain: string, tag: string, policy: AccessPolicy): Promise<{ id: string }>;
  // Replace the policy set of an existing app (idempotent updates on drift).
  updateAppPolicy(appId: string, policy: AccessPolicy): Promise<void>;
  deleteApp(id: string): Promise<void>;
  // READ-ONLY: list service tokens so a service_auth policy can resolve a token
  // NAME (e.g. "bosun-kiosk") to its stable CF token id. NEVER creates/deletes.
  listServiceTokens(): Promise<Array<{ id: string; name: string }>>;
}

// Tag format identifying Access apps owned by a specific bosun stack. Mirrors
// stackRouteTag from routes.ts. Only apps carrying this exact tag are eligible
// for prune — anything else is foreign and must not be touched.
/** @public — bosun access-gate spec surface, consumed by deploy.config.ts at cutover (www-cuuw) */
export function stackAccessTag(stackName: string): string {
  return `bosun:${stackName}`;
}

// Map an AccessSpec to a CF policy, resolving any serviceToken include rule's
// token NAME to its CF token id via the provided lookup. A pure function over
// the spec + the resolved-token map (built once by reconcileAccess from
// listServiceTokens). An unknown token name is a hard error — never a silent
// skip that would create a service_auth app nobody can authenticate to.
function specToPolicy(access: AccessSpec, tokenIdByName: Map<string, string>): AccessPolicy {
  const include: AccessIncludeRule[] = [];
  for (const rule of access.include ?? []) {
    if (rule.kind === "email") {
      include.push({ email: { email: rule.email } });
    } else {
      const tokenId = tokenIdByName.get(rule.tokenName);
      if (!tokenId) {
        throw new Error(
          `reconcileAccess: service token '${rule.tokenName}' not found in Cloudflare Access ` +
            "(create it first with scripts/save-cf-access-tokens.sh)",
        );
      }
      include.push({ service_token: { token_id: tokenId } });
    }
  }
  // A block app (the floor) allows nobody, so it carries the CF "Everyone"
  // selector with a block decision — that is what makes it deny everything.
  if (access.decision === "block" && include.length === 0) {
    include.push({ everyone: {} });
  }
  return { decision: access.decision, include };
}

// Reconcile Cloudflare Access applications:
//   1. Create declared apps that don't exist yet, tagged for this stack, with
//      their policy.
//   2. Update the policy of a declared app that already exists (so a changed
//      include rule / decision converges).
//   3. Prune ONLY apps tagged for THIS stack that are no longer declared.
// Foreign apps (no tag or a different stack's tag) are never deleted. Service
// tokens are never touched.
/** @public — bosun access-gate spec surface, consumed by deploy.config.ts at cutover (www-cuuw) */
export async function reconcileAccess(
  stackName: string,
  declared: DesiredAccessApp[],
  client: CloudflareAccessClient,
): Promise<void> {
  const tag = stackAccessTag(stackName);

  // Resolve service-token names -> CF ids ONCE. Only needed if a declared app
  // uses a serviceToken rule; skip the API call otherwise so an Access-Read
  // scope isn't required for email-only / floor-only deploys.
  const needsTokens = declared.some((d) =>
    (d.access.include ?? []).some((r) => r.kind === "serviceToken"),
  );
  const tokenIdByName = new Map<string, string>();
  if (needsTokens) {
    for (const t of await client.listServiceTokens()) tokenIdByName.set(t.name, t.id);
  }

  const existing = await client.listApps();
  const existingByDomain = new Map(existing.map((a) => [a.domain, a]));

  // Create or update each declared app.
  for (const { domain, access } of declared) {
    const policy = specToPolicy(access, tokenIdByName);
    const live = existingByDomain.get(domain);
    if (!live) {
      await client.createApp(domain, tag, policy);
    } else {
      // Converge the policy on an already-present app. Cheap and idempotent on
      // the CF side; keeps a changed decision/include from drifting.
      await client.updateAppPolicy(live.id, policy);
    }
  }

  // Prune only stack-owned apps that are no longer declared.
  const declaredDomains = new Set(declared.map((d) => d.domain));
  for (const app of existing) {
    const isOurs = app.tags.includes(tag);
    if (isOurs && !declaredDomains.has(app.domain)) {
      await client.deleteApp(app.id);
    }
  }
}

// Default Cloudflare Access client using the CF Access API directly. The token is
// resolved by the caller from 1Password — never stored here. Mirrors
// makeDefaultCloudflareRouteClient's shape (account-scoped endpoints, bearer auth).
/** @public — bosun access-gate spec surface, consumed by deploy.config.ts at cutover (www-cuuw) */
export function makeDefaultCloudflareAccessClient(
  accountId: string,
  apiToken: string,
): CloudflareAccessClient {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/access`;
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  return {
    async listApps() {
      const res = await fetch(`${baseUrl}/apps?per_page=100`, { headers });
      if (!res.ok) throw new Error(`CF Access API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        result?: Array<{ id: string; domain?: string; tags?: string[] }>;
      };
      return (data.result ?? []).map((a) => ({
        id: a.id,
        domain: a.domain ?? "",
        tags: a.tags ?? [],
      }));
    },

    async createApp(domain, tag, policy) {
      // Self-hosted app + an app-scoped policy in one create. CF accepts a
      // `policies` array inline on app creation.
      const res = await fetch(`${baseUrl}/apps`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: domain,
          type: "self_hosted",
          domain,
          tags: [tag],
          policies: [{ name: domain, ...policy }],
        }),
      });
      if (!res.ok) throw new Error(`CF Access API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { result?: { id?: string } };
      return { id: data.result?.id ?? domain };
    },

    async updateAppPolicy(appId, policy) {
      // PUT the app's policy set. The app-scoped policies live under the app, so
      // a PUT to the app with the new `policies` array converges them.
      const res = await fetch(`${baseUrl}/apps/${appId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ policies: [{ name: appId, ...policy }] }),
      });
      if (!res.ok) throw new Error(`CF Access API error ${res.status}: ${await res.text()}`);
    },

    async deleteApp(id) {
      const res = await fetch(`${baseUrl}/apps/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error(`CF Access API error ${res.status}: ${await res.text()}`);
    },

    async listServiceTokens() {
      const res = await fetch(`${baseUrl}/service_tokens?per_page=100`, { headers });
      if (!res.ok) throw new Error(`CF Access API error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        result?: Array<{ id: string; name?: string }>;
      };
      return (data.result ?? []).map((t) => ({ id: t.id, name: t.name ?? "" }));
    },
  };
}
