/**
 * Unit tests for the Sonos favorites service (www-51hf.11).
 * Verifies A13: sonosFavorites query backed by real Sonos ContentDirectory Browse FV:2.
 * All SonosClient calls are mocked , no network required.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SonosFavorite } from "../integrations/sonos";
import { SonosError } from "../integrations/sonos";

// ─── mock SonosClient ─────────────────────────────────────────────────────────

type MockClient = {
  browseFavorites: ReturnType<typeof vi.fn>;
};

const mockClients: Record<string, MockClient> = {};

function makeMockClient(): MockClient {
  return {
    browseFavorites: vi.fn(),
  };
}

vi.mock("../integrations/sonos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/sonos")>();
  return {
    ...actual,
    SonosClient: vi.fn().mockImplementation((ip: string) => {
      if (!mockClients[ip]) {
        mockClients[ip] = makeMockClient();
      }
      return mockClients[ip];
    }),
  };
});

// ─── import after mock ────────────────────────────────────────────────────────

import { getSonosFavorites } from "../services/sonos-favorites-service";

// ─── fixture data ─────────────────────────────────────────────────────────────

const FAVORITES: SonosFavorite[] = [
  {
    title: "Riordan Radio",
    uri: "x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75",
    albumArtUri: "http://192.168.0.193:1400/getaa?s=1&u=...&v=...",
  },
  {
    title: "Late Night Jazz",
    uri: "x-sonosapi-stream:s123456?sid=254&flags=8224&sn=0",
    albumArtUri: null,
  },
];

// ─── tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  for (const key of Object.keys(mockClients)) {
    delete mockClients[key];
  }
});

describe("getSonosFavorites , happy path (A13)", () => {
  it("returns the favorites list from Browse FV:2", async () => {
    // The service uses the topology anchor IP to issue the Browse
    const anchorIp = "192.168.0.193";
    mockClients[anchorIp] = makeMockClient();
    mockClients[anchorIp].browseFavorites.mockResolvedValue(FAVORITES);

    const result = await getSonosFavorites();

    expect(result).toHaveLength(2);
  });

  it("maps title, uri, and albumArtUri for each favorite", async () => {
    const anchorIp = "192.168.0.193";
    mockClients[anchorIp] = makeMockClient();
    mockClients[anchorIp].browseFavorites.mockResolvedValue(FAVORITES);

    const result = await getSonosFavorites();

    expect(result[0]).toMatchObject({
      title: "Riordan Radio",
      uri: "x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75",
      albumArtUri: "http://192.168.0.193:1400/getaa?s=1&u=...&v=...",
    });
    expect(result[1]).toMatchObject({
      title: "Late Night Jazz",
      uri: "x-sonosapi-stream:s123456?sid=254&flags=8224&sn=0",
      albumArtUri: null,
    });
  });

  it("returns an empty array when no favorites exist", async () => {
    const anchorIp = "192.168.0.193";
    mockClients[anchorIp] = makeMockClient();
    mockClients[anchorIp].browseFavorites.mockResolvedValue([]);

    const result = await getSonosFavorites();

    expect(result).toHaveLength(0);
  });
});

describe("getSonosFavorites , error handling (A3)", () => {
  it("throws SonosError when Browse FV:2 fails", async () => {
    const anchorIp = "192.168.0.193";
    mockClients[anchorIp] = makeMockClient();
    mockClients[anchorIp].browseFavorites.mockRejectedValue(
      new SonosError("Browse FV:2: network error"),
    );

    await expect(getSonosFavorites()).rejects.toBeInstanceOf(SonosError);
  });

  it("does not catch errors , callers see the raw SonosError (never fabricated data)", async () => {
    const anchorIp = "192.168.0.193";
    mockClients[anchorIp] = makeMockClient();
    mockClients[anchorIp].browseFavorites.mockRejectedValue(new SonosError("ETIMEDOUT"));

    // The error must propagate , never swallowed and replaced with empty/stub data.
    await expect(getSonosFavorites()).rejects.toThrow("ETIMEDOUT");
  });
});
