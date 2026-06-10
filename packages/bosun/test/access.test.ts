import { describe, expect, it, vi } from "vitest";
import {
  type AccessApp,
  type CloudflareAccessClient,
  type DesiredAccessApp,
  makeDefaultCloudflareAccessClient,
  reconcileAccess,
  stackAccessTag,
} from "../src/reconcile/access.ts";
import { accessEmail, accessEmailEnv, accessFloor, accessServiceToken } from "../src/spec.ts";

// ---------------------------------------------------------------------------
// reconcile/access.ts — prune safety + policy mapping + token id resolution
// ---------------------------------------------------------------------------
//
// Mirrors the reconcile/routes prune-safety block. A dependency-injected fake
// CloudflareAccessClient means no real CF API is touched. The core invariant:
// reconcileAccess only ever creates/updates declared apps and prunes ONLY apps
// carrying THIS stack's tag — never a foreign app, never a service token.

const STACK = "control-center";
const TAG = stackAccessTag(STACK);

function makeAccessClient(
  existingApps: AccessApp[] = [],
  serviceTokens: Array<{ id: string; name: string }> = [],
): CloudflareAccessClient {
  const apps = [...existingApps];
  return {
    listApps: vi.fn().mockResolvedValue(apps),
    createApp: vi.fn().mockResolvedValue({ id: "new-app" }),
    updateAppPolicy: vi.fn().mockResolvedValue(undefined),
    deleteApp: vi.fn().mockResolvedValue(undefined),
    listServiceTokens: vi.fn().mockResolvedValue(serviceTokens),
  };
}

const mockOf = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("reconcileAccess — create + idempotency", () => {
  it("creates a declared app that is absent, tagged for this stack", async () => {
    const client = makeAccessClient([]);
    const declared: DesiredAccessApp[] = [
      { domain: "storybook.worldwidewebb.co", access: accessEmail("calum@example.com") },
    ];
    await reconcileAccess(STACK, declared, client);
    expect(client.createApp).toHaveBeenCalledOnce();
    const [domainArg, tagArg, policyArg] = mockOf(client.createApp).mock.calls[0];
    expect(domainArg).toBe("storybook.worldwidewebb.co");
    expect(tagArg).toBe(TAG);
    expect(policyArg).toEqual({
      decision: "allow",
      include: [{ email: { email: "calum@example.com" } }],
    });
    expect(client.deleteApp).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-present declared app is not re-created (policy converged instead)", async () => {
    const client = makeAccessClient([
      { id: "app-sb", domain: "storybook.worldwidewebb.co", tags: [TAG] },
    ]);
    const declared: DesiredAccessApp[] = [
      { domain: "storybook.worldwidewebb.co", access: accessEmail("calum@example.com") },
    ];
    await reconcileAccess(STACK, declared, client);
    expect(client.createApp).not.toHaveBeenCalled();
    expect(client.updateAppPolicy).toHaveBeenCalledOnce();
    const [appIdArg] = mockOf(client.updateAppPolicy).mock.calls[0];
    expect(appIdArg).toBe("app-sb");
    expect(client.deleteApp).not.toHaveBeenCalled();
  });
});

describe("reconcileAccess — prune safety", () => {
  it("prunes ONLY a tag-owned orphan app, never a foreign app", async () => {
    const ours = { id: "app-old", domain: "old.worldwidewebb.co", tags: [TAG] };
    const foreignUntagged = { id: "app-x", domain: "portainer.example.com", tags: [] };
    const foreignOtherStack = {
      id: "app-y",
      domain: "y.example.com",
      tags: [stackAccessTag("some-other-stack")],
    };
    const client = makeAccessClient([ours, foreignUntagged, foreignOtherStack]);
    // Nothing declared for those domains -> only OUR orphan is eligible for prune.
    await reconcileAccess(STACK, [], client);
    expect(client.deleteApp).toHaveBeenCalledOnce();
    expect(mockOf(client.deleteApp).mock.calls[0][0]).toBe("app-old");
  });

  it("empty declared set + NO tag-owned apps -> no deletes (the step-1 ship-now safety property)", async () => {
    const foreign = { id: "app-x", domain: "foreign.example.com", tags: [] };
    const client = makeAccessClient([foreign]);
    await reconcileAccess(STACK, [], client);
    expect(client.createApp).not.toHaveBeenCalled();
    expect(client.deleteApp).not.toHaveBeenCalled();
  });

  it("empty declared set + a tag-owned app -> prune (symmetry with routes)", async () => {
    const ours = { id: "app-old", domain: "old.worldwidewebb.co", tags: [TAG] };
    const client = makeAccessClient([ours]);
    await reconcileAccess(STACK, [], client);
    expect(client.deleteApp).toHaveBeenCalledOnce();
    expect(mockOf(client.deleteApp).mock.calls[0][0]).toBe("app-old");
  });
});

describe("reconcileAccess — policy mapping for all three builders", () => {
  it("accessEmail -> allow + email include", async () => {
    const client = makeAccessClient([]);
    await reconcileAccess(
      STACK,
      [{ domain: "storybook.worldwidewebb.co", access: accessEmail("calum@example.com") }],
      client,
    );
    expect(mockOf(client.createApp).mock.calls[0][2]).toEqual({
      decision: "allow",
      include: [{ email: { email: "calum@example.com" } }],
    });
  });

  it("accessServiceToken -> service_auth + token include (id resolved by NAME)", async () => {
    const client = makeAccessClient([], [{ id: "tok-123", name: "bosun-kiosk" }]);
    await reconcileAccess(
      STACK,
      [
        {
          domain: "dashboard.worldwidewebb.co",
          access: accessServiceToken({
            tokenName: "bosun-kiosk",
            clientIdEnv: "CF_ACCESS_KIOSK_CLIENT_ID",
          }),
        },
      ],
      client,
    );
    expect(client.listServiceTokens).toHaveBeenCalledOnce();
    expect(mockOf(client.createApp).mock.calls[0][2]).toEqual({
      decision: "service_auth",
      include: [{ service_token: { token_id: "tok-123" } }],
    });
  });

  it("accessFloor -> block + everyone include (deny all)", async () => {
    const client = makeAccessClient([]);
    await reconcileAccess(STACK, [{ domain: "*.worldwidewebb.co", access: accessFloor() }], client);
    expect(mockOf(client.createApp).mock.calls[0][2]).toEqual({
      decision: "block",
      include: [{ everyone: {} }],
    });
  });

  it("accessEmailEnv -> allow + email include resolved from the emailByEnvVar map", async () => {
    const client = makeAccessClient([]);
    await reconcileAccess(
      STACK,
      [
        {
          domain: "storybook.worldwidewebb.co",
          access: accessEmailEnv("CF_ACCESS_ALLOWED_EMAIL"),
        },
      ],
      client,
      new Map([["CF_ACCESS_ALLOWED_EMAIL", "calum@example.com"]]),
    );
    expect(mockOf(client.createApp).mock.calls[0][2]).toEqual({
      decision: "allow",
      include: [{ email: { email: "calum@example.com" } }],
    });
  });

  it("accessEmailEnv throws a clear error when the env var is unresolved (never a silent skip)", async () => {
    const client = makeAccessClient([]);
    await expect(
      reconcileAccess(
        STACK,
        [
          {
            domain: "storybook.worldwidewebb.co",
            access: accessEmailEnv("CF_ACCESS_ALLOWED_EMAIL"),
          },
        ],
        client,
        new Map(), // env var not resolved
      ),
    ).rejects.toThrow(/allowed-email env var 'CF_ACCESS_ALLOWED_EMAIL' is unset/);
    expect(client.createApp).not.toHaveBeenCalled();
  });
});

describe("reconcileAccess — service token resolution", () => {
  it("resolves token NAME -> CF id via listServiceTokens", async () => {
    const client = makeAccessClient(
      [],
      [
        { id: "tok-ci", name: "bosun-ci" },
        { id: "tok-kiosk", name: "bosun-kiosk" },
      ],
    );
    await reconcileAccess(
      STACK,
      [
        {
          domain: "hooks.worldwidewebb.co",
          access: accessServiceToken({
            tokenName: "bosun-ci",
            clientIdEnv: "CF_ACCESS_CI_CLIENT_ID",
          }),
        },
      ],
      client,
    );
    expect(mockOf(client.createApp).mock.calls[0][2].include).toEqual([
      { service_token: { token_id: "tok-ci" } },
    ]);
  });

  it("throws a clear error for an unknown token name (never a silent skip)", async () => {
    const client = makeAccessClient([], [{ id: "tok-other", name: "some-other-token" }]);
    await expect(
      reconcileAccess(
        STACK,
        [
          {
            domain: "dashboard.worldwidewebb.co",
            access: accessServiceToken({
              tokenName: "bosun-kiosk",
              clientIdEnv: "CF_ACCESS_KIOSK_CLIENT_ID",
            }),
          },
        ],
        client,
      ),
    ).rejects.toThrow(/service token 'bosun-kiosk' not found/);
    expect(client.createApp).not.toHaveBeenCalled();
  });

  it("does NOT call listServiceTokens when no declared app uses a service token", async () => {
    // Email-only / floor-only deploys must not require Access: Service Tokens Read.
    const client = makeAccessClient([]);
    await reconcileAccess(
      STACK,
      [
        { domain: "storybook.worldwidewebb.co", access: accessEmail("calum@example.com") },
        { domain: "*.worldwidewebb.co", access: accessFloor() },
      ],
      client,
    );
    expect(client.listServiceTokens).not.toHaveBeenCalled();
  });
});

describe("reconcileAccess — service tokens are never deleted", () => {
  it("never calls any token-mutation path (the client has no delete-token method)", async () => {
    const client = makeAccessClient([], [{ id: "tok-kiosk", name: "bosun-kiosk" }]);
    await reconcileAccess(
      STACK,
      [
        {
          domain: "dashboard.worldwidewebb.co",
          access: accessServiceToken({
            tokenName: "bosun-kiosk",
            clientIdEnv: "CF_ACCESS_KIOSK_CLIENT_ID",
          }),
        },
      ],
      client,
    );
    // The interface exposes no create/delete service-token method by design, so
    // this asserts the only token interaction was the read.
    expect(client.listServiceTokens).toHaveBeenCalledOnce();
    expect(Object.keys(client)).not.toContain("deleteServiceToken");
    expect(Object.keys(client)).not.toContain("createServiceToken");
  });
});

// ---------------------------------------------------------------------------
// live CloudflareAccessClient — endpoint/method/body shape (fetch stubbed)
// ---------------------------------------------------------------------------

describe("live Cloudflare Access client", () => {
  const ACCOUNT = "acct-1";
  const TOKEN = "cf-token";

  function stubFetch(body: unknown, ok = true, status = 200) {
    return vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  it("listApps GETs the access/apps endpoint and maps id/domain/tags", async () => {
    const fetchMock = stubFetch({
      result: [{ id: "a1", domain: "dashboard.worldwidewebb.co", tags: ["bosun:control-center"] }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    const apps = await client.listApps();
    expect(apps).toEqual([
      { id: "a1", domain: "dashboard.worldwidewebb.co", tags: ["bosun:control-center"] },
    ]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT}/access/apps`);
    expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    vi.unstubAllGlobals();
  });

  it("createApp POSTs a self_hosted app with domain, tag and inline policy", async () => {
    const fetchMock = stubFetch({ result: { id: "created-1" } });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    const out = await client.createApp("storybook.worldwidewebb.co", "bosun:control-center", {
      decision: "allow",
      include: [{ email: { email: "calum@example.com" } }],
    });
    expect(out.id).toBe("created-1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT}/access/apps`);
    expect(opts.method).toBe("POST");
    const sent = JSON.parse(opts.body);
    expect(sent.type).toBe("self_hosted");
    expect(sent.domain).toBe("storybook.worldwidewebb.co");
    expect(sent.tags).toEqual(["bosun:control-center"]);
    expect(sent.policies[0].decision).toBe("allow");
    vi.unstubAllGlobals();
  });

  it("updateAppPolicy PUTs the app with the new policies", async () => {
    const fetchMock = stubFetch({ result: {} });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    await client.updateAppPolicy("app-1", { decision: "block", include: [{ everyone: {} }] });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT}/access/apps/app-1`);
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body).policies[0].decision).toBe("block");
    vi.unstubAllGlobals();
  });

  it("deleteApp DELETEs the app by id", async () => {
    const fetchMock = stubFetch({ result: {} });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    await client.deleteApp("app-9");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT}/access/apps/app-9`);
    expect(opts.method).toBe("DELETE");
    vi.unstubAllGlobals();
  });

  it("listServiceTokens GETs service_tokens and maps id/name", async () => {
    const fetchMock = stubFetch({ result: [{ id: "t1", name: "bosun-kiosk" }] });
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    const tokens = await client.listServiceTokens();
    expect(tokens).toEqual([{ id: "t1", name: "bosun-kiosk" }]);
    expect(fetchMock.mock.calls[0][0]).toContain(`/accounts/${ACCOUNT}/access/service_tokens`);
    vi.unstubAllGlobals();
  });

  it("throws on a non-ok CF response", async () => {
    const fetchMock = stubFetch({ errors: ["nope"] }, false, 403);
    vi.stubGlobal("fetch", fetchMock);
    const client = makeDefaultCloudflareAccessClient(ACCOUNT, TOKEN);
    await expect(client.listApps()).rejects.toThrow(/CF Access API error 403/);
    vi.unstubAllGlobals();
  });
});
