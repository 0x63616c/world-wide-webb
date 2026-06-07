import { describe, expect, it, vi } from "vitest";
import { BOSUN_IMAGE_NAME, buildDeployCommand, runWebhookDeploy } from "../src/serve.ts";

// www-fmws: the resident bosun-agent must NOT render the deploy from the
// deploy.config.ts baked into its OWN (one-version-behind) image. Instead, on a
// webhook it launches a one-shot `docker run` of the FRESHLY-BUILT bosun image
// (the control-center-bosun digest is right there in the webhook payload), which
// carries the NEW config AND the NEW builders. These tests pin the command the
// builder constructs from a payload — the actual `docker run` is the injected
// Runner in cli.ts, so this is exercised without docker.

const SOCK = "/var/run/docker.sock";

function cfg(overrides: Partial<Parameters<typeof buildDeployCommand>[1]> = {}) {
  return {
    stackName: "control-center",
    dockerSocket: SOCK,
    // Env names the one-shot inherits from the agent so the inner `bosun up`
    // can resolve secrets (op), log in to ghcr, and sync CF routes.
    passEnv: ["OP_SERVICE_ACCOUNT_TOKEN", "GHCR_PULL_TOKEN", "CF_ACCOUNT_ID", "CF_TUNNEL_ID"],
    env: {
      OP_SERVICE_ACCOUNT_TOKEN: "op-tok",
      GHCR_PULL_TOKEN: "ghcr-tok",
      CF_ACCOUNT_ID: "acct",
      CF_TUNNEL_ID: "tun",
    } as Record<string, string | undefined>,
    ...overrides,
  };
}

describe("buildDeployCommand — fresh-image one-shot deploy (www-fmws)", () => {
  const digest = "sha256:abc123";
  const images = { [BOSUN_IMAGE_NAME]: digest, "control-center-api": "sha256:def456" };

  it("runs the bosun image PINNED TO THE PAYLOAD DIGEST, not :main", () => {
    const cmd = buildDeployCommand(images, cfg());
    expect(cmd).not.toBeNull();
    // The whole point: the new config/builders come from the freshly-built image.
    expect(cmd).toContain(`ghcr.io/0x63616c/${BOSUN_IMAGE_NAME}@${digest}`);
    expect(cmd).not.toContain(`${BOSUN_IMAGE_NAME}:main`);
  });

  it("mounts the docker socket so the inner `bosun up` can deploy the stack", () => {
    const cmd = buildDeployCommand(images, cfg()) ?? "";
    expect(cmd).toContain(`-v ${SOCK}:${SOCK}`);
  });

  it("is an ephemeral container (--rm)", () => {
    const cmd = buildDeployCommand(images, cfg()) ?? "";
    expect(cmd).toContain("docker run");
    expect(cmd).toContain("--rm");
  });

  it("passes through ONLY the env vars that are present on the agent", () => {
    const cmd =
      buildDeployCommand(
        images,
        cfg({
          env: { OP_SERVICE_ACCOUNT_TOKEN: "op-tok", CF_ACCOUNT_ID: undefined },
        }),
      ) ?? "";
    expect(cmd).toContain("-e OP_SERVICE_ACCOUNT_TOKEN");
    // Absent on the agent -> never forwarded (no empty `-e CF_ACCOUNT_ID=`).
    expect(cmd).not.toContain("CF_ACCOUNT_ID");
    expect(cmd).not.toContain("GHCR_PULL_TOKEN");
  });

  it("passes the FULL image-digest payload as the positional `up` arg (so it still digest-pins every service)", () => {
    const cmd = buildDeployCommand(images, cfg()) ?? "";
    // `... <image> up '<json>'` — the digest map is the positional arg to up.
    const m = cmd.match(/\bup ('([^']*)')\s*$/);
    expect(m).not.toBeNull();
    const raw = (m?.[2] ?? "").replace(/^'|'$/g, "");
    // Every digest survives the round-trip, not just bosun's.
    expect(JSON.parse(raw)).toEqual(images);
  });

  it("runs the image's NORMAL entrypoint with `up` (no --entrypoint override, no inlined ghcr login)", () => {
    const cmd = buildDeployCommand(images, cfg()) ?? "";
    // Option 2: the entrypoint dispatches on args and does the ghcr login + env
    // bridging itself, so the builder must NOT override the entrypoint or inline
    // the login.
    expect(cmd).not.toContain("--entrypoint");
    expect(cmd).not.toContain("docker login");
    // `... <image> up ...` — image immediately precedes the `up` subcommand.
    expect(cmd).toMatch(new RegExp(`${BOSUN_IMAGE_NAME}@${digest} up `));
  });

  it("returns null when the payload lacks the bosun digest (no fresh image to run -> caller falls back)", () => {
    expect(buildDeployCommand({ "control-center-api": "sha256:x" }, cfg())).toBeNull();
    expect(buildDeployCommand(undefined, cfg())).toBeNull();
  });
});

describe("runWebhookDeploy — one-shot vs in-process fallback (www-fmws)", () => {
  const env = { OP_SERVICE_ACCOUNT_TOKEN: "op-tok" } as Record<string, string | undefined>;

  function deps(over: Partial<Parameters<typeof runWebhookDeploy>[1]> = {}) {
    return {
      stackName: "control-center",
      runner: vi.fn(async () => ({ exitCode: 0 })),
      inProcessUp: vi.fn(async () => {}),
      env,
      log: () => {},
      ...over,
    };
  }

  it("runs the fresh-image one-shot (NOT in-process) when the payload carries the bosun digest", async () => {
    const runner = vi.fn(async (_cmd: string) => ({ exitCode: 0 }));
    const d = deps({ runner });
    await runWebhookDeploy({ [BOSUN_IMAGE_NAME]: "sha256:fresh" }, d);
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][0]).toContain(`${BOSUN_IMAGE_NAME}@sha256:fresh`);
    // The stale in-process path must NOT run — that's the whole bug.
    expect(d.inProcessUp).not.toHaveBeenCalled();
  });

  it("falls back to in-process bosun up when the payload has no bosun digest (manual/legacy)", async () => {
    const d = deps();
    await runWebhookDeploy(undefined, d);
    expect(d.inProcessUp).toHaveBeenCalledWith(undefined);
    expect(d.runner).not.toHaveBeenCalled();
  });

  it("forwards the digest map to the in-process fallback so a body-but-no-bosun deploy still pins", async () => {
    const d = deps();
    const images = { "control-center-api": "sha256:api" };
    await runWebhookDeploy(images, d);
    expect(d.inProcessUp).toHaveBeenCalledWith(images);
    expect(d.runner).not.toHaveBeenCalled();
  });

  it("throws (so serve logs it) when the one-shot exits non-zero", async () => {
    const d = deps({ runner: vi.fn(async () => ({ exitCode: 17 })) });
    await expect(runWebhookDeploy({ [BOSUN_IMAGE_NAME]: "sha256:fresh" }, d)).rejects.toThrow(
      /exited 17/,
    );
  });
});
