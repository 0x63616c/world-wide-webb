import { afterEach, describe, expect, it, vi } from "vitest";
import { portalClient } from "./trpc";

// Stubs global fetch with a minimal @trpc/client v11 httpBatchLink-compatible
// response: a JSON array (batch envelope) of `{ result: { data } }` per op.
// Captures the fetch call args so we can assert the batch link wired
// portal.* onto /trpc (not /api/trpc) with the right HTTP method/body.
function stubFetchReturning(data: unknown) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [{ result: { data } }],
      text: async () => JSON.stringify([{ result: { data } }]),
    }),
  );
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

describe("portalClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a GET to /trpc/portal.status and resolves with the server data", async () => {
    const fetchMock = stubFetchReturning({ state: "active" });

    const result = await portalClient.status({ mac: "aa:bb:cc:dd:ee:ff" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("/trpc/portal.status")).toBe(true);
    expect(init?.method ?? "GET").toBe("GET");
    expect(result).toEqual({ state: "active" });
  });

  it("issues a POST to /trpc/portal.checkPassword carrying the password in the body", async () => {
    const fetchMock = stubFetchReturning({ ok: true });

    const result = await portalClient.checkPassword({
      mac: "aa:bb:cc:dd:ee:ff",
      password: "hunter2",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("/trpc/portal.checkPassword")).toBe(true);
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("hunter2");
    expect(result).toEqual({ ok: true });
  });
});
