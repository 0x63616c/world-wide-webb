// Command dispatcher for the bosun CLI.
// Entry point: `bun run bosun <cmd>` (root package.json "bosun" script).
import { makeDefaultFetcher, makeDefaultRunner, runProbes, summarizeVerify } from "./health.ts";

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  switch (command) {
    case "plan":
      await cmdPlan();
      break;
    case "secrets":
      await cmdSecrets(args);
      break;
    case "routes":
      await cmdRoutes(args);
      break;
    case "up":
      await cmdUp();
      break;
    case "verify":
      await cmdVerify();
      break;
    case "serve":
      await cmdServe();
      break;
    case "run-job":
      await cmdRunJob(args);
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

function printUsage(): void {
  console.error(
    [
      "Usage: bun run bosun <command>",
      "",
      "Commands:",
      "  plan          Evaluate deploy.config.ts and print the static Spec (no secrets)",
      "  secrets sync  Resolve secret refs and reconcile docker secrets",
      "  routes sync   Reconcile Cloudflare tunnel routes",
      "  up            Full deploy: plan → secrets sync → routes sync → stack deploy → verify",
      "  verify        Run all declared health probes; exit 0 iff all pass",
      "  serve         Start the webhook receiver for CI-triggered deploys",
      "  run-job <name>  Fire one cronJob() now (same Swarm-job path the scheduler uses)",
    ].join("\n"),
  );
}

async function loadSpec() {
  // Dynamically import the deploy.config.ts at the repo root. Using a dynamic
  // import keeps cli.ts itself pure — config eval happens at call time only.
  const configPath = `${process.cwd()}/deploy.config.ts`;
  const mod = (await import(configPath)) as { default: unknown };
  return mod.default;
}

// plan: evaluate the config and print the static Spec (no secret values).
async function cmdPlan(): Promise<void> {
  const spec = await loadSpec();
  console.log(JSON.stringify(spec, null, 2));
}

// secrets sync: resolve refs via providers and reconcile docker secrets.
async function cmdSecrets(args: string[]): Promise<void> {
  if (args[0] !== "sync") {
    console.error("Usage: bosun secrets sync");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");
  const { reconcileSecrets, makeDefaultDockerSecretClient } = await import(
    "./reconcile/secrets.ts"
  );

  const exec = await makeDefaultExec();
  const provider = new OpProvider(exec);

  // Collect all secret refs across all services.
  const allRefs = spec.services.flatMap((svc) => svc.secrets);
  const resolved = await Promise.all(
    allRefs.map(async (ref) => ({
      name: ref.name,
      resolvedValue: await provider.resolve(ref.ref),
    })),
  );

  const client = makeDefaultDockerSecretClient();
  const nameMap = await reconcileSecrets(spec.stackName, resolved, client);
  console.log("Secrets synced:", nameMap);
}

// routes sync: reconcile Cloudflare tunnel routes from declared route: fields.
async function cmdRoutes(args: string[]): Promise<void> {
  if (args[0] !== "sync") {
    console.error("Usage: bosun routes sync");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { reconcileRoutes, makeDefaultCloudflareRouteClient, stackRouteTag } = await import(
    "./reconcile/routes.ts"
  );
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");

  const exec = await makeDefaultExec();
  const provider = new OpProvider(exec);
  const apiToken = await provider.resolve("op://Homelab/Cloudflare API/credential");

  // ACCOUNT_ID and TUNNEL_ID must be provided via env (non-secret identifiers).
  const accountId = process.env.CF_ACCOUNT_ID;
  const tunnelId = process.env.CF_TUNNEL_ID;
  if (!accountId || !tunnelId) {
    console.error("CF_ACCOUNT_ID and CF_TUNNEL_ID must be set in the environment");
    process.exit(1);
  }

  // Map each declared hostname to its origin (http://<service>:<port>) so the
  // live client knows where to point a newly-created route.
  const originByHostname: Record<string, string> = {};
  for (const svc of spec.services) {
    if (svc.route) originByHostname[svc.route] = `http://${svc.name}:${svc.port ?? 80}`;
  }
  // Ownership for safe prune: a live route is ours iff its origin points at one
  // of this stack's services (CF ingress has no tag field). Cron jobs aren't
  // routable origins, so only real services count.
  const stackServiceNames = spec.services.filter((svc) => !svc.schedule).map((svc) => svc.name);
  const client = makeDefaultCloudflareRouteClient(
    accountId,
    tunnelId,
    apiToken,
    (hostname) => originByHostname[hostname] ?? "",
    { stackTag: stackRouteTag(spec.stackName), stackServiceNames },
  );
  const declared = spec.services.flatMap((svc) => (svc.route ? [svc.route] : []));
  await reconcileRoutes(spec.stackName, declared, client);
  console.log("Routes synced:", declared);
}

// up: plan → secrets sync → routes sync → docker stack deploy → verify.
// `imageOverrides` (from the deploy webhook body) pins our ghcr images to the
// exact digests CI built, so the stack deploy reliably rolls changed services
// instead of depending on :main tag re-resolution (www-czg).
async function cmdUp(
  imageOverrides?: Record<string, string>,
  // Verify policy. The interactive `up` (operator at a terminal) fails on a red
  // verify so a broken deploy is loud. The webhook serve path passes true: the
  // stack deploy already succeeded, and probes that are merely not-yet-warm
  // (cold climate endpoint, etc.) must not make it look like a deploy error
  // (www-1dx). The verify still runs and logs in both cases.
  opts: { advisoryVerify?: boolean } = {},
): Promise<void> {
  console.log("[bosun up] Loading config...");
  if (imageOverrides && Object.keys(imageOverrides).length > 0) {
    console.log("[bosun up] Pinning images by digest:", imageOverrides);
  }
  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };

  console.log("[bosun up] Syncing secrets...");
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");
  const { reconcileSecrets, makeDefaultDockerSecretClient } = await import(
    "./reconcile/secrets.ts"
  );

  const exec = await makeDefaultExec();
  const provider = new OpProvider(exec);
  const allRefs = spec.services.flatMap((svc) => svc.secrets);
  const resolved = await Promise.all(
    allRefs.map(async (ref) => ({
      name: ref.name,
      resolvedValue: await provider.resolve(ref.ref),
    })),
  );
  const secretClient = makeDefaultDockerSecretClient();
  const secretNames = await reconcileSecrets(spec.stackName, resolved, secretClient);

  console.log("[bosun up] Rendering stack and deploying...");
  const { renderStackYml, deployStack } = await import("./reconcile/stack.ts");
  const yml = renderStackYml(spec, secretNames, imageOverrides);
  const deployOut = await deployStack(spec.stackName, yml);
  if (deployOut) console.log(deployOut);

  console.log("[bosun up] Verifying...");
  await runVerify(
    spec.services.flatMap((svc) => svc.health),
    opts.advisoryVerify ?? false,
  );
}

// verify: run all declared health probes; exit 0 iff all pass.
async function cmdVerify(): Promise<void> {
  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const probes = spec.services.flatMap((svc) => svc.health);
  // Interactive verify: a red probe must fail loudly.
  await runVerify(probes, false);
}

async function runVerify(
  probes: import("./spec.ts").HealthProbe[],
  advisory: boolean,
): Promise<void> {
  const result = await runProbes(probes, {
    fetcher: makeDefaultFetcher(),
    runner: makeDefaultRunner(),
  });

  const { lines, failed } = summarizeVerify(result, advisory);
  for (const line of lines) console.log(line);

  // Advisory (serve path): never exit — a not-yet-warm probe must not look like a
  // failed deploy (www-1dx). Interactive `up`/`verify`: exit non-zero so a broken
  // deploy is loud.
  if (failed) {
    process.exit(result.exitCode);
  }
}

// serve: start the webhook receiver that runs `up` on authenticated POST.
// The deploy path is namespaced per stack (/deploy/<stack>), so the request
// routing + auth live in the pure handler in serve.ts (unit-tested there).
async function cmdServe(): Promise<void> {
  const port = Number(process.env.BOSUN_PORT ?? 4202);
  const token = process.env.BOSUN_WEBHOOK_TOKEN;
  if (!token) {
    console.error("BOSUN_WEBHOOK_TOKEN must be set");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { handleServeRequest } = await import("./serve.ts");

  // Start the in-process cron scheduler. This agent is the long-lived process on
  // a manager node with the docker socket, so it runs each cronJob() on its
  // schedule as a one-shot Swarm job — replacing the old third-party scheduler pod.
  const { startScheduler } = await import("./scheduler.ts");
  startScheduler(spec.services, spec.stackName, makeDefaultRunner(), console.log);

  console.log(`[bosun serve] Listening on :${port} for POST /deploy/${spec.stackName}`);

  Bun.serve({
    port,
    fetch(req) {
      return handleServeRequest(req, {
        stackName: spec.stackName,
        token,
        // Run deploy in the background; the handler responds 202 immediately.
        // The digest map from the webhook body is threaded into the render so
        // changed services roll deterministically (www-czg).
        // Advisory verify on the serve path: a successful stack deploy whose
        // probes are merely not-yet-warm must not surface as a deploy error
        // (www-1dx). A genuine deploy failure (secrets/render/stack deploy) still
        // throws out of cmdUp and is logged here.
        onDeploy: (imageOverrides) =>
          cmdUp(imageOverrides, { advisoryVerify: true }).catch((err) =>
            console.error("[bosun serve] deploy error:", err),
          ),
      });
    },
  });
}

// run-job <name>: fire one cronJob() immediately, on demand. Runs the SAME
// buildJobCommand() path the scheduler uses on its cron, so a manual run is
// byte-identical to a scheduled one (docker service create --mode replicated-job).
// This is the on-demand trigger the scheduler lacked: it unblocks e2e proof
// (no waiting for 03:00) and gives operators a manual re-run.
async function cmdRunJob(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: bosun run-job <name>");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { selectCronJob, buildJobCommand, jobServiceName } = await import("./scheduler.ts");

  // Throws a clear error (unknown name / not a cron job) before touching docker.
  const job = selectCronJob(spec.services, name);
  const svc = jobServiceName(spec.stackName, name);
  const cmd = buildJobCommand(job, spec.stackName);

  console.log(`[bosun run-job] firing '${name}' as Swarm job ${svc}`);
  const { exitCode } = await makeDefaultRunner()(cmd);
  if (exitCode !== 0) {
    console.error(`[bosun run-job] '${name}' service create exited ${exitCode}`);
    process.exit(exitCode);
  }
  console.log(
    `[bosun run-job] '${name}' dispatched. Inspect: docker service ps ${svc} (visible in Portainer)`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
