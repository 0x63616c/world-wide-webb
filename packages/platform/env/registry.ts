/**
 * The lazy, memoized env registry. `defineEnv(spec)` returns a Proxy accessor
 * whose keys parse the (already-hydrated) `process.env` on first access and
 * cache thereafter — never eagerly at construction, so import order can never
 * freeze a pre-hydration default (design spec §5.3).
 *
 * A single module-level cache per registry backs both the registry and every
 * `pick()` projection, so a key parsed once is shared. `__resetEnvCache()` is a
 * test-only hook; `registrySpec()` exposes the declared spec to `assert.ts`.
 */
import type { FieldBuilder } from "./fields.ts";

type AnySpec = Record<string, FieldBuilder<unknown>>;

type ValueOf<F> = F extends FieldBuilder<infer T> ? T : never;

type EnvValues<S extends AnySpec> = { readonly [K in keyof S]: ValueOf<S[K]> };

type Picked<S extends AnySpec, K extends keyof S> = { readonly [P in K]: ValueOf<S[P]> };

/** The typed accessor `defineEnv` returns: every key, plus `pick()`. */
export type Registry<S extends AnySpec> = EnvValues<S> & {
  pick<K extends keyof S & string>(...keys: K[]): Picked<S, K>;
};

// Symbols carry the spec + cache on the Proxy target so tooling (assertEnv,
// __resetEnvCache) can reach them without polluting the string-keyed surface.
const SPEC = Symbol("env.spec");
const CACHE = Symbol("env.cache");

interface Internals {
  [SPEC]: AnySpec;
  [CACHE]: Map<string, unknown>;
}

function resolveKey(spec: AnySpec, cache: Map<string, unknown>, key: string): unknown {
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) return cached;
  const field = spec[key];
  if (!field) throw new Error(`@www/platform/env: unknown key "${key}"`);
  const value = field.resolve(process.env[key]);
  cache.set(key, value);
  return value;
}

function makePick(spec: AnySpec, cache: Map<string, unknown>, keys: string[]): unknown {
  const allowed = new Set(keys);
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (!allowed.has(prop)) {
          throw new Error(
            `@www/platform/env: config read key "${prop}" it did not pick — add it to the pick() list`,
          );
        }
        return resolveKey(spec, cache, prop);
      },
      has(_t, prop) {
        return typeof prop === "string" && allowed.has(prop);
      },
      ownKeys() {
        return [...allowed];
      },
      getOwnPropertyDescriptor(_t, prop) {
        if (typeof prop === "string" && allowed.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
            writable: false,
            value: resolveKey(spec, cache, prop),
          };
        }
        return undefined;
      },
    },
  );
}

/**
 * Declare an env registry. Nothing is read from `process.env` here; each key is
 * parsed lazily on first access and memoized.
 */
export function defineEnv<S extends AnySpec>(spec: S): Registry<S> {
  const cache = new Map<string, unknown>();
  const target: Internals = { [SPEC]: spec, [CACHE]: cache };

  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(t, prop, receiver);
      if (prop === "pick") {
        return (...keys: string[]) => makePick(spec, cache, keys);
      }
      if (prop in spec) return resolveKey(spec, cache, prop);
      return undefined;
    },
    has(_t, prop) {
      return typeof prop === "string" && (prop === "pick" || prop in spec);
    },
    ownKeys() {
      return Object.keys(spec);
    },
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop === "string" && prop in spec) {
        return {
          enumerable: true,
          configurable: true,
          writable: false,
          value: resolveKey(spec, cache, prop),
        };
      }
      return undefined;
    },
  });

  return proxy as unknown as Registry<S>;
}

/** Expose a registry's declared spec (for `assertEnv`). Internal. */
export function registrySpec(registry: unknown): AnySpec {
  return (registry as { [SPEC]?: AnySpec })[SPEC] ?? {};
}

/** Test-only: clear a registry's memoized cache so a key re-reads `process.env`. */
export function __resetEnvCache(registry: unknown): void {
  (registry as { [CACHE]?: Map<string, unknown> })[CACHE]?.clear();
}
