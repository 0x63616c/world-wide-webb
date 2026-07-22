import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DeviceIdPlugin,
  getDeviceId,
  resetDeviceIdForTests,
  resolveDeviceId,
  setDevicePluginForTests,
  slugifyModel,
} from "../device-id";

const STORAGE_KEY = "cc-device-id";

// jsdom on an opaque origin (about:blank) exposes no localStorage, so the module
// would fall back to its no-storage path and nothing would persist. Install a
// minimal in-memory Storage so these tests exercise the real persistence logic
// (mirrors device-name.test.ts).
function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  const fake = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  vi.stubGlobal("localStorage", fake);
  Object.defineProperty(window, "localStorage", { value: fake, configurable: true });
}

/** A fake @capacitor/device plugin , the native happy path without the plugin. */
function fakePlugin(model: string, identifier: string): DeviceIdPlugin {
  return {
    getInfo: async () => ({ model }),
    getId: async () => ({ identifier }),
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  resetDeviceIdForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("slugifyModel", () => {
  it("lowercases and collapses non-alphanumeric runs to a single dash", () => {
    expect(slugifyModel("iPad13,1")).toBe("ipad13-1");
    expect(slugifyModel("iPhone15,3")).toBe("iphone15-3");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyModel("  x86_64  ")).toBe("x86-64");
    expect(slugifyModel("--iPad--")).toBe("ipad");
  });
});

describe("device id", () => {
  it("derives `<model-slug>-<idfv8>` from the native plugin and persists it", async () => {
    setDevicePluginForTests(fakePlugin("iPad13,1", "3F9A2C1B-DEAD-BEEF-0000-000000000000"));
    const id = await resolveDeviceId();
    expect(id).toBe("ipad13-1-3f9a2c1b");
    // Persisted and cached: the sync getter returns the same resolved id.
    expect(getDeviceId()).toBe("ipad13-1-3f9a2c1b");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("ipad13-1-3f9a2c1b");
  });

  it("mints a persisted `web-<8 hex>` fallback off-device", async () => {
    setDevicePluginForTests(null);
    const id = await resolveDeviceId();
    expect(id).toMatch(/^web-[0-9a-f]{8}$/);
    expect(getDeviceId()).toBe(id);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it("keeps the same id across a simulated reload", async () => {
    setDevicePluginForTests(null);
    const first = await resolveDeviceId();
    // Reload: drop the in-memory cache and plugin handle, keep localStorage.
    resetDeviceIdForTests();
    setDevicePluginForTests(null);
    expect(getDeviceId()).toBe(first);
    expect(await resolveDeviceId()).toBe(first);
  });

  it("mints the web fallback exactly once (stable across sync reads)", () => {
    setDevicePluginForTests(null);
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBe(b);
  });

  it("overwrites an early web fallback with the native id once resolved", async () => {
    // A log line during boot reads the sync getter before resolution and mints a
    // web fallback; resolveDeviceId then replaces it with the OS-derived id.
    setDevicePluginForTests(fakePlugin("iPhone15,3", "AABBCCDD-0000-0000-0000-000000000000"));
    const early = getDeviceId();
    expect(early).toMatch(/^web-/);
    const resolved = await resolveDeviceId();
    expect(resolved).toBe("iphone15-3-aabbccdd");
    expect(getDeviceId()).toBe("iphone15-3-aabbccdd");
  });

  it("falls back to the web id when the native plugin returns junk", async () => {
    setDevicePluginForTests(fakePlugin("", "not-hex-at-all-zzzz"));
    const id = await resolveDeviceId();
    expect(id).toMatch(/^web-[0-9a-f]{8}$/);
  });

  it("falls back to the web id when the native plugin throws", async () => {
    setDevicePluginForTests({
      getInfo: async () => {
        throw new Error("plugin exploded");
      },
      getId: async () => ({ identifier: "abcdef01" }),
    });
    const id = await resolveDeviceId();
    expect(id).toMatch(/^web-[0-9a-f]{8}$/);
  });
});
