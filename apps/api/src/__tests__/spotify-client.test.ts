/**
 * Unit tests for SpotifyClient (CC-51hf.33).
 * Validates token refresh, caching, and throw-on-unconfigured behaviour.
 * All network calls are stubbed — tests never reach the Spotify API.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotifyClient, SpotifyError } from "../integrations/spotify";

const VALID_CREDS = {
  clientId: "test_client_id",
  clientSecret: "test_client_secret",
  refreshToken: "test_refresh_token",
};

function tokenResponse(expiresIn = 3600): Response {
  return new Response(
    JSON.stringify({
      access_token: "test_access_token",
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: "user-read-playback-state user-modify-playback-state",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("SpotifyClient — token refresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws SpotifyError when SPOTIFY_CLIENT_ID is empty", async () => {
    const client = new SpotifyClient({
      clientId: "",
      clientSecret: "secret",
      refreshToken: "refresh",
    });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SpotifyError);
  });

  it("throws SpotifyError when SPOTIFY_CLIENT_SECRET is empty", async () => {
    const client = new SpotifyClient({
      clientId: "id",
      clientSecret: "",
      refreshToken: "refresh",
    });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SpotifyError);
  });

  it("throws SpotifyError when SPOTIFY_REFRESH_TOKEN is empty", async () => {
    const client = new SpotifyClient({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "",
    });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SpotifyError);
  });

  it("fetches a new token on first call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse()));
    const client = new SpotifyClient(VALID_CREDS);
    const token = await client.getAccessToken();
    expect(token).toBe("test_access_token");
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it("returns cached token without a second fetch call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse(3600));
    vi.stubGlobal("fetch", fetchMock);
    const client = new SpotifyClient(VALID_CREDS);
    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();
    expect(t1).toBe(t2);
    // Only one network request — second call hits the cache.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("re-fetches when the token is within 60s of expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse(55)) // first token expires in 55s (< 60s threshold)
      .mockResolvedValueOnce(tokenResponse(3600)); // second fresh token
    vi.stubGlobal("fetch", fetchMock);
    const client = new SpotifyClient(VALID_CREDS);
    await client.getAccessToken(); // primes the near-expired cache
    const token2 = await client.getAccessToken(); // should re-fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(token2).toBe("test_access_token");
  });

  it("throws SpotifyError when the refresh request returns 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
        ),
    );
    const client = new SpotifyClient(VALID_CREDS);
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SpotifyError);
  });

  it("throws SpotifyError on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = new SpotifyClient(VALID_CREDS);
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(SpotifyError);
  });
});

describe("SpotifyError", () => {
  it("is an instance of Error", () => {
    const err = new SpotifyError("test error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SpotifyError");
    expect(err.message).toBe("test error");
  });
});
