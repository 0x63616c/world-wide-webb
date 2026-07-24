import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetEnvCache,
  bool,
  defineEnv,
  enumOf,
  int,
  num,
  pgUrl,
  secret,
  str,
  url,
} from "../env";

// Keys these tests poke into process.env — cleared between cases so one test's
// late "hydration" never leaks into the next.
const TOUCHED = ["HA_TOKEN", "HOME_LAT", "PORT", "FLAG", "PICK_A", "PICK_B", "APP_ENV"];

function clear() {
  for (const k of TOUCHED) delete process.env[k];
}

beforeEach(clear);
afterEach(clear);

describe("order-independence regression (the headline bug)", () => {
  it("reads the hydrated value even when the config was built before hydration", () => {
    // A feature config declared/imported BEFORE the secret is hydrated.
    const ENV = defineEnv({ HA_TOKEN: secret().required().devDefault("") });
    __resetEnvCache(ENV);
    // process.env.HA_TOKEN is unset here. Building the registry must NOT throw
    // and must NOT freeze a default — nothing is parsed until first access.
    expect(() => defineEnv({ HA_TOKEN: secret().required().devDefault("") })).not.toThrow();

    // Late hydration writes the real secret into process.env.
    process.env.HA_TOKEN = "real-token-xyz";

    // First access happens AFTER hydration → sees the real value, not "".
    // Against the old eager `parse(process.env)` this returned "" (the bug).
    expect(ENV.HA_TOKEN).toBe("real-token-xyz");
  });
});

describe("field builders", () => {
  it("str/secret pass a value through", () => {
    const ENV = defineEnv({ HA_TOKEN: str().default("d") });
    __resetEnvCache(ENV);
    process.env.HA_TOKEN = "hello";
    expect(ENV.HA_TOKEN).toBe("hello");
  });

  it("url validates and rejects a non-URL", () => {
    const ENV = defineEnv({ HA_TOKEN: url().default("http://x.local") });
    __resetEnvCache(ENV);
    process.env.HA_TOKEN = "not a url";
    expect(() => ENV.HA_TOKEN).toThrow();
  });

  it("pgUrl rejects a non-postgres URL", () => {
    const ENV = defineEnv({ HA_TOKEN: pgUrl().required() });
    __resetEnvCache(ENV);
    process.env.HA_TOKEN = "https://example.com";
    expect(() => ENV.HA_TOKEN).toThrow();
    __resetEnvCache(ENV);
    process.env.HA_TOKEN = "postgresql://u:p@h:5432/db";
    expect(ENV.HA_TOKEN).toBe("postgresql://u:p@h:5432/db");
  });

  it("num/int coerce numbers", () => {
    const ENV = defineEnv({ HOME_LAT: num().default(0), PORT: int().default(1) });
    __resetEnvCache(ENV);
    process.env.HOME_LAT = "34.05";
    process.env.PORT = "4201";
    expect(ENV.HOME_LAT).toBe(34.05);
    expect(ENV.PORT).toBe(4201);
  });

  it("bool maps true/1 to true, anything else to false", () => {
    const mk = (v: string) => {
      const ENV = defineEnv({ FLAG: bool().default(false) });
      __resetEnvCache(ENV);
      process.env.FLAG = v;
      return ENV.FLAG;
    };
    expect(mk("true")).toBe(true);
    expect(mk("1")).toBe(true);
    expect(mk("false")).toBe(false);
    expect(mk("yes")).toBe(false);
  });

  it("enumOf accepts a member and rejects a non-member", () => {
    const ENV = defineEnv({ FLAG: enumOf("a", "b", "c").default("a") });
    __resetEnvCache(ENV);
    process.env.FLAG = "b";
    expect(ENV.FLAG).toBe("b");
    __resetEnvCache(ENV);
    process.env.FLAG = "z";
    expect(() => ENV.FLAG).toThrow();
  });

  it("default applies when absent; devDefault only outside production", () => {
    const withDefault = defineEnv({ PORT: int().default(4201) });
    __resetEnvCache(withDefault);
    expect(withDefault.PORT).toBe(4201);

    const withDev = defineEnv({ HOME_LAT: num().required().devDefault(34.0537) });
    __resetEnvCache(withDev);
    delete process.env.APP_ENV; // dev
    expect(withDev.HOME_LAT).toBe(34.0537);

    __resetEnvCache(withDev);
    process.env.APP_ENV = "production";
    // In prod the devDefault does NOT apply — the key resolves to undefined
    // (assertEnv is what crashes the boot; resolve itself is honest).
    expect(withDev.HOME_LAT).toBeUndefined();
  });

  it("optional resolves to undefined when absent", () => {
    const ENV = defineEnv({ PORT: int().optional() });
    __resetEnvCache(ENV);
    expect(ENV.PORT).toBeUndefined();
  });
});

describe("memoization", () => {
  it("caches the first read; __resetEnvCache forces a re-read", () => {
    const ENV = defineEnv({ HA_TOKEN: str().default("d") });
    __resetEnvCache(ENV);
    process.env.HA_TOKEN = "first";
    expect(ENV.HA_TOKEN).toBe("first");
    process.env.HA_TOKEN = "second";
    // Cached — still the first value.
    expect(ENV.HA_TOKEN).toBe("first");
    __resetEnvCache(ENV);
    expect(ENV.HA_TOKEN).toBe("second");
  });
});

describe("pick() projection", () => {
  it("returns picked keys from the shared cache and throws on unpicked keys", () => {
    const ENV = defineEnv({
      PICK_A: str().default("a"),
      PICK_B: str().default("b"),
    });
    __resetEnvCache(ENV);
    process.env.PICK_A = "va";
    process.env.PICK_B = "vb";
    const view = ENV.pick("PICK_A");
    expect(view.PICK_A).toBe("va");
    // @ts-expect-error PICK_B is not in the picked set — a type AND runtime error.
    expect(() => view.PICK_B).toThrow();
  });

  it("shares the cache with the parent registry", () => {
    const ENV = defineEnv({ PICK_A: str().default("a") });
    __resetEnvCache(ENV);
    process.env.PICK_A = "shared";
    const view = ENV.pick("PICK_A");
    expect(ENV.PICK_A).toBe("shared");
    // Mutate env then confirm the view reads the SAME cached value (not a re-read).
    process.env.PICK_A = "changed";
    expect(view.PICK_A).toBe("shared");
  });
});
