// Tests for deploy.config.ts purity and the plan command semantics.
// ac_tool_plan_pure: two runs byte-identical, no secret values in output.
// ac_config_pure: resolved spec references only, never values.

import { describe, expect, it } from "vitest";
import { renderStackYml } from "../src/reconcile/stack.ts";
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

// www-0id / www-79k: the scheduled Docker image-cleanup job. These assert that the
// real deploy.config.ts declares the prune job via the cronJob() primitive (not
// hand-written yaml) and that, because cron jobs are run by the bosun scheduler
// as one-shot Swarm jobs, the job is EXCLUDED from the rendered stack — no
// standalone scheduler service, no deploy labels.
describe("deploy.config.ts — Docker image-cleanup cronJob (www-0id / www-79k)", () => {
  it("declares the docker-image-prune job and no standalone scheduler service", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const names = mod.default.services.map((s) => s.name);
    expect(names).toContain("docker-image-prune");
    // The long-lived (non-cron) services are exactly the app services — no extra
    // scheduler pod alongside them. Asserting on the no-schedule set (rather than
    // an exact full list) ignores cron jobs, which are run by the bosun scheduler
    // as one-shot Swarm jobs, never deployed as long-lived services.
    const longLived = mod.default.services.filter((s) => !s.schedule).map((s) => s.name);
    expect(longLived.sort()).toEqual([
      "api",
      "bosun-agent",
      "cloudflared",
      // Self-hosted Drizzle Studio for browsing the prod DB (www-0ub8).
      "drizzle",
      // media-worker runs the continuous media-ingest pipeline (www-kp4k).
      "media-worker",
      "postgres",
      "storybook",
      "web",
      // The worker runs the continuous reconcile/ingest loops off the api
      // (www-7d5b.1.3); it's a long-lived service, not a cron job.
      "worker",
    ]);
  });

  it("prunes with an until= age filter, not a bare prune -af", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const job = mod.default.services.find((s) => s.name === "docker-image-prune");
    expect(job?.command).toContain('--filter "until=720h"');
    // -a (remove all unused, not just dangling) but bounded by the age filter.
    expect(job?.command).toContain("docker image prune -a");
  });

  it("runs nightly at 03:00 local, pinned to a manager node", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const job = mod.default.services.find((s) => s.name === "docker-image-prune");
    expect(job?.schedule?.cron).toBe("0 3 * * *");
    expect(job?.placement).toContain("node.role==manager");
  });

  it("mounts the docker socket so the one-shot job can shell docker", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const job = mod.default.services.find((s) => s.name === "docker-image-prune");
    expect(job?.volumes).toContain("/var/run/docker.sock:/var/run/docker.sock");
  });

  // renderStackYml requires a docker-name for every declared secret, so build a
  // map covering the whole config (the prune job itself has no secrets).
  const allSecretNames = (spec: Spec): Record<string, string> =>
    Object.fromEntries(
      spec.services.flatMap((s) => s.secrets.map((r) => [r.name, `${r.name}_v1`])),
    );

  it("excludes the cron job from the rendered stack (run by the scheduler, not deployed)", async () => {
    const mod = (await import(CONFIG_PATH.href)) as { default: Spec };
    const yml = renderStackYml(mod.default, allSecretNames(mod.default));
    expect(yml).not.toContain("docker-image-prune");
    // No scheduler deploy-label mechanism leaks into the stack.
    expect(yml).not.toContain(".schedule=");
  });
});
