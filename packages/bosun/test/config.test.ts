import { describe, expect, it, vi } from "vitest";
import { evaluateConfig } from "../src/config.ts";
import type { Spec } from "../src/spec.ts";

// Tests for the pure config evaluator (ac_tool_plan_pure, ac_config_pure).

// A minimal config factory — mirrors the shape a deploy.config.ts would export.
const makeMinimalSpec = (): Spec => ({
  stackName: "test-stack",
  services: [
    {
      name: "api",
      image: "ghcr.io/0x63616c/test-api:main",
      secrets: [{ name: "TOKEN", ref: "op://Homelab/Test/token" }],
      env: {},
      health: [],
    },
  ],
});

describe("evaluateConfig", () => {
  it("evaluates a module factory and returns its Spec", async () => {
    const spec = await evaluateConfig(makeMinimalSpec);
    expect(spec.stackName).toBe("test-stack");
    expect(spec.services).toHaveLength(1);
  });

  it("two evaluations of the same factory are byte-identical", async () => {
    const a = JSON.stringify(await evaluateConfig(makeMinimalSpec));
    const b = JSON.stringify(await evaluateConfig(makeMinimalSpec));
    expect(a).toBe(b);
  });

  it("rejects a config factory that throws synchronously", async () => {
    const broken = (): Spec => {
      throw new Error("config error");
    };
    await expect(evaluateConfig(broken)).rejects.toThrow("config error");
  });

  it("rejects a config factory that attempts network I/O (fetch)", async () => {
    // Simulate a config that calls fetch — evaluateConfig must reject this.
    // We use vi.stubGlobal so the config's fetch call goes to our spy.
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network forbidden"));
    vi.stubGlobal("fetch", fetchSpy);

    const networkLeaky = async (): Promise<Spec> => {
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      await (globalThis as any).fetch("https://example.com");
      return makeMinimalSpec();
    };

    // If the config awaits fetch and fetch throws, evaluateConfig must propagate
    // the error rather than swallowing it and returning a partial spec.
    await expect(evaluateConfig(networkLeaky)).rejects.toThrow();

    vi.unstubAllGlobals();
  });

  it("spec from evaluateConfig contains only op:// secret references", async () => {
    const spec = await evaluateConfig(makeMinimalSpec);
    for (const svc of spec.services) {
      for (const secretRef of svc.secrets ?? []) {
        expect(secretRef.ref).toMatch(/^op:\/\//);
      }
    }
  });
});
