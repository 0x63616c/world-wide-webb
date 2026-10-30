import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  config: { HA_URL: "http://ha.test", HA_TOKEN: "synthetic-ha-token" },
}));

import { camerasRouter } from "./api";
import { routes } from "./http";
import { cameraSnapshot } from "./service";

afterEach(() => vi.unstubAllGlobals());

describe("cameras API", () => {
  it("lists only camera IDs, labels and states; never attributes or tokens", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json([
        { entity_id: "camera.test_b", state: "unavailable", attributes: {}, last_updated: "t" },
        {
          entity_id: "camera.test_a",
          state: "idle",
          attributes: {
            friendly_name: "Test Camera",
            access_token: "do-not-return",
            entity_picture: "/secret",
          },
          last_updated: "t",
        },
        { entity_id: "light.test", state: "on", last_updated: "t" },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const caller = camerasRouter.createCaller({} as never);
    expect(await caller.list()).toEqual([
      { id: "camera.test_a", name: "Test Camera", state: "idle" },
      { id: "camera.test_b", name: "camera.test_b", state: "unavailable" },
    ]);
    expect(fetch.mock.calls[0][0]).toBe("http://ha.test/api/states");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-ha-token");
  });

  it("accepts no configured cameras and sanitizes an HA outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json([]))
        .mockResolvedValueOnce(new Response("private upstream detail", { status: 401 })),
    );
    const caller = camerasRouter.createCaller({} as never);
    expect(await caller.list()).toEqual([]);
    await expect(caller.list()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Home Assistant unavailable: Cameras unavailable",
    });
  });
});

describe("camera snapshots", () => {
  it("streams the binary image with server auth and no upstream headers", async () => {
    const bytes = new Uint8Array([255, 216, 255, 217]);
    const fetch = vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: {
          "Content-Type": "image/jpeg",
          "Set-Cookie": "private=value",
          "Cache-Control": "public",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await cameraSnapshot("camera.test_a");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(fetch.mock.calls[0][0]).toBe("http://ha.test/api/camera_proxy/camera.test_a");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer synthetic-ha-token");
  });

  it.each([
    "light.test",
    "camera.foo?token=x",
    "camera.foo/bar",
    "camera.%2e%2e",
    "https://evil.test",
  ])("rejects unsafe ID %s before fetching", async (id) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await cameraSnapshot(id)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([404, 401, 500])("does not forward the HA error body (%s)", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private upstream detail", { status })),
    );
    const response = await cameraSnapshot("camera.test_a");
    expect(response.status).toBe(status === 404 ? 404 : 503);
    expect(await response.json()).toEqual({ error: "Snapshot unavailable" });
  });

  it.each([
    "text/html",
    "image/svg+xml",
    "multipart/x-mixed-replace",
  ])("rejects %s", async (type) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unsafe", { headers: { "Content-Type": type } })),
    );
    expect((await cameraSnapshot("camera.test_a")).status).toBe(502);
  });

  it("handles transport failure and rejects unknown paths/query strings", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("private network detail"));
    vi.stubGlobal("fetch", fetch);
    expect((await cameraSnapshot("camera.test_a")).status).toBe(503);
    for (const path of [
      "/media/cameras/camera.test_a/stream",
      "/media/cameras/camera.test_a/snapshot?url=evil",
    ]) {
      const req = new Request(`https://panel.test${path}`);
      expect((await routes[0].handler(req, new URL(req.url))).status).toBe(404);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
