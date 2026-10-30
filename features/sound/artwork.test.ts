import { describe, expect, it, vi } from "vitest";
import { sonosArtwork } from "./artwork";
import { routes } from "./http";

const id = "media_player.example";
describe("Sonos artwork proxy", () => {
  it("streams only image bytes and approved headers through the configured HA client", async () => {
    const getMedia = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "image/png; charset=binary",
          "Set-Cookie": "synthetic",
          Location: "/private",
        },
      }),
    );
    const response = await sonosArtwork(id, { isConfigured: () => true, getMedia });
    expect(getMedia).toHaveBeenCalledExactlyOnceWith(`/api/media_player_proxy/${id}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.fromEntries(response.headers)).toEqual({
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
  it.each([
    "",
    "media_player.",
    "camera.example",
    "media_player.x/../y",
    "https://example.invalid",
    "media_player.x?token=x",
  ])("rejects %s before fetching", async (value) => {
    const getMedia = vi.fn();
    expect((await sonosArtwork(value, { isConfigured: () => true, getMedia })).status).toBe(400);
    expect(getMedia).not.toHaveBeenCalled();
  });
  it.each([
    "text/html",
    "image/svg+xml",
    "application/json",
  ])("rejects %s responses", async (type) => {
    const response = await sonosArtwork(id, {
      isConfigured: () => true,
      getMedia: async () => new Response("untrusted", { headers: { "Content-Type": type } }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("untrusted");
  });
  it("redacts upstream failures and handles unconfigured HA", async () => {
    const getMedia = vi.fn().mockRejectedValue(new Error("private upstream detail"));
    for (const configured of [false, true]) {
      const response = await sonosArtwork(id, { isConfigured: () => configured, getMedia });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Artwork unavailable" });
    }
    expect(getMedia).toHaveBeenCalledOnce();
  });
  it("rejects malformed paths and query strings at the HTTP boundary", async () => {
    for (const path of ["/media/sonos/x", `/media/sonos/${id}/artwork?url=private`]) {
      const url = new URL(path, "https://panel.example.invalid");
      const response = await routes[0].handler(new Request(url), url);
      expect(response?.status).toBe(404);
    }
  });
});
