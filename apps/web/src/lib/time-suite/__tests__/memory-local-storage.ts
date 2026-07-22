/**
 * Test helper: jsdom here runs on an opaque origin (about:blank), which
 * exposes NO localStorage , the stores would silently take their no-storage
 * path and none of the persistence/boot-resume logic would be exercised.
 * Installs a minimal in-memory Storage (mirrors device-id.test.ts /
 * device-name.test.ts). Undo with vi.unstubAllGlobals().
 */

import { vi } from "vitest";

export function installMemoryLocalStorage(): void {
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
