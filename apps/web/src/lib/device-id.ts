/**
 * Stable per-device identity for log shipping , a dependency-light singleton that
 * hands out one readable, unique id for this panel/browser (e.g.
 * "ipad13-1-3f9a2c1b"). Distinct from lib/device-name.ts on purpose:
 *
 *   - device NAME is a human label, user-editable, display-only, never identity.
 *   - device ID is stable identity: it keys the shipped rows on the backend
 *     (`(device_id, entry_id)`), so it must not follow a rename and must survive
 *     WebKit evicting script-writable storage.
 *
 * Native (Expo): `<model-slug>-<idfv8>` , the model and identifierForVendor
 * supplied by the panel shell, with the model slugified and the ID shortened
 * identifierForVendor). Both are OS-derived, so the id survives storage eviction
 * and app updates and changes only on uninstall+reinstall , which genuinely is a
 * new log source, so that is the right behaviour.
 *
 * Web (browser / a component harness / tests): `web-<8 hex>` minted once and persisted in
 * localStorage. There is no OS identity to lean on, so a persisted random suffix
 * is the stable-enough answer.
 *
 * Resolved once at boot via an async plugin call (`resolveDeviceId`) and cached
 * in memory. The sync getter (`getDeviceId`) never blocks and never throws: a
 * caller reading it before resolution gets the persisted id, or a freshly-minted
 * web fallback, so a log line written during boot always has *an* id. On native
 * that early fallback is overwritten by the real OS-derived id the moment
 * `resolveDeviceId` completes, and every later boot reads the persisted real id.
 *
 * The shell bridge is absent in a plain browser, preserving the web fallback.
 */

import { isNativeShell, nativeRequest } from "./native-bridge";

const STORAGE_KEY = "cc-device-id";

// ─── best-effort localStorage IO (guarded , SSR/tests/private-mode Safari) ─────

function readRaw(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // persistence is best-effort (blocked / full store)
  }
}

// ─── pure id construction (deterministic, unit-testable) ───────────────────────

/**
 * Lowercase a device model into a readable slug: any run of non-alphanumerics
 * collapses to a single dash, and leading/trailing dashes are trimmed. e.g.
 * "iPad13,1" -> "ipad13-1", "iPhone15,3" -> "iphone15-3".
 */
export function slugifyModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** First 8 hex chars of an identifierForVendor, lowercased and stripped of dashes. */
function idfv8(identifier: string): string {
  return identifier
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
}

/** 8 lowercase hex chars, from crypto if available, else a Math.random fallback. */
function randomHex8(): string {
  try {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, "0");
  }
}

// ─── Expo shell bridge (injectable for tests) ─────────────────────────────────

/**
 * The two Device operations we use. Typed locally so a test can inject a fake
 * without the plugin present (the setDevicePluginForTests seam below).
 */
export interface DeviceIdPlugin {
  getInfo(): Promise<{ model: string }>;
  getId(): Promise<{ identifier: string }>;
}

// Resolved once. `null` = not native / plugin missing / init failed: web fallback.
let pluginPromise: Promise<DeviceIdPlugin | null> | null = null;
// The resolved id, cached so the sync getter is free on every log write.
let cache: string | null = null;

async function loadPlugin(): Promise<DeviceIdPlugin | null> {
  if (!isNativeShell()) return null;
  return {
    getInfo: async () => {
      const device = await nativeRequest<{ model: string; identifier: string }>("deviceInfo");
      return { model: device.model };
    },
    getId: async () => {
      const device = await nativeRequest<{ model: string; identifier: string }>("deviceInfo");
      return { identifier: device.identifier };
    },
  };
}

function getPlugin(): Promise<DeviceIdPlugin | null> {
  if (!pluginPromise) {
    // Belt and braces: getPlugin() must never reject , resolve/getDeviceId await
    // it outside their try blocks (off-device is a null return, not an error).
    pluginPromise = loadPlugin().catch(() => null);
  }
  return pluginPromise;
}

// ─── public API ────────────────────────────────────────────────────────────────

/**
 * The device id to use right now. Cheap (cached) and never throws , safe to call
 * on every log write. Before resolution completes it returns the persisted id,
 * or mints and persists a `web-<hex>` fallback so a line is never id-less. On
 * native that fallback is replaced by the OS-derived id once resolveDeviceId runs.
 */
export function getDeviceId(): string {
  if (cache !== null) return cache;
  const persisted = readRaw(STORAGE_KEY);
  if (persisted?.trim()) {
    cache = persisted;
    return cache;
  }
  const minted = `web-${randomHex8()}`;
  writeRaw(STORAGE_KEY, minted);
  cache = minted;
  return cache;
}

/**
 * Resolve the stable id once, at boot. On native, derives `<model-slug>-<idfv8>`
 * from the Device plugin and persists it (overwriting any early web fallback);
 * off-device or on any plugin failure it falls back to the persisted/minted web
 * id. Best-effort , never throws. Returns the resolved id.
 */
export async function resolveDeviceId(): Promise<string> {
  const plugin = await getPlugin();
  if (plugin) {
    try {
      const [{ model }, { identifier }] = await Promise.all([plugin.getInfo(), plugin.getId()]);
      const slug = slugifyModel(model);
      const suffix = idfv8(identifier);
      if (slug && suffix) {
        const id = `${slug}-${suffix}`;
        cache = id;
        writeRaw(STORAGE_KEY, id);
        return id;
      }
      // Plugin returned junk (empty model / non-hex identifier) , fall through to
      // the web fallback rather than emit a malformed id.
    } catch {
      // Plugin call failed , fall through.
    }
  }
  return getDeviceId();
}

/** Test seam: inject a fake Device plugin (or null to simulate off-device). */
export function setDevicePluginForTests(plugin: DeviceIdPlugin | null): void {
  pluginPromise = Promise.resolve(plugin);
}

/** Test seam: forget the cached id and plugin handle so a test can start clean. */
export function resetDeviceIdForTests(): void {
  cache = null;
  pluginPromise = null;
}
