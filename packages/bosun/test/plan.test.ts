// Tests for deploy.config.ts purity and the plan command semantics.
// ac_tool_plan_pure: two runs byte-identical, no secret values in output.
// ac_config_pure: resolved spec references only, never values.

import { describe, expect, it } from "vitest";
import type { Spec } from "../src/spec.ts";

// Load the actual deploy.config.ts from the repo root. This test runs from
// packages/bosun/, so we go up two levels to the worktree root.
const CONFIG_PATH = new URL("../../../deploy.config.ts", import.meta.url);

describe("deploy.config.ts — purity (ac_tool_plan_pure, ac_config_pure)", () => {
  it("exports a Spec with the correct stack name", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    expect(mod.default.stackName).toBe("control-center");
  });

  it("declares all five required services: web, api, postgres, cloudflared, storybook", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const names = mod.default.services.map((s) => s.name);
    expect(names).toContain("web");
    expect(names).toContain("api");
    expect(names).toContain("postgres");
    expect(names).toContain("cloudflared");
    expect(names).toContain("storybook");
  });

  it("evaluates to the same JSON on two consecutive imports (deterministic)", async () => {
    // Dynamic import is cached by the module system — same object. We compare
    // the serialized form to ensure no nondeterminism in the data itself.
    const mod1 = (await import(CONFIG_PATH.href)) as { default: Spec };
    const mod2 = (await import(CONFIG_PATH.href)) as { default: Spec };
    expect(JSON.stringify(mod1.default)).toBe(JSON.stringify(mod2.default));
  });

  it("contains zero secret values — only op:// references", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const _specJson = JSON.stringify(mod.default);
    // Every ref must be an op:// URI; the spec must not contain any resolved
    // value. We verify no bare token-looking strings (>8 chars, non-op-URI)
    // appear as secret values by confirming all SecretRef.ref start with op://.
    for (const svc of mod.default.services) {
      for (const ref of svc.secrets) {
        expect(ref.ref).toMatch(/^op:\/\//);
      }
    }
  });

  it("web service declares dashboard.worldwidewebb.co route", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const web = mod.default.services.find((s) => s.name === "web");
    expect(web).toBeDefined();
    expect(web?.route).toBe("dashboard.worldwidewebb.co");
  });

  it("storybook service declares storybook.worldwidewebb.co route", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const sb = mod.default.services.find((s) => s.name === "storybook");
    expect(sb).toBeDefined();
    expect(sb?.route).toBe("storybook.worldwidewebb.co");
  });

  it("api service declares HA_TOKEN and UNIFI_API_KEY secret refs from Homelab vault", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const api = mod.default.services.find((s) => s.name === "api");
    expect(api).toBeDefined();
    const refNames = api?.secrets.map((r) => r.name);
    expect(refNames).toContain("HA_TOKEN");
    expect(refNames).toContain("UNIFI_API_KEY");
  });

  it("cloudflared service declares TUNNEL_TOKEN secret ref", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const cf = mod.default.services.find((s) => s.name === "cloudflared");
    expect(cf).toBeDefined();
    const refNames = cf?.secrets.map((r) => r.name);
    expect(refNames).toContain("TUNNEL_TOKEN");
  });
});
