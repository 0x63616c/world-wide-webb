// Command dispatcher for the bosun CLI.
// Entry point: `bun run bosun <cmd>` (root package.json "bosun" script).
//
// process.env reads are sanctioned here by the biome noProcessEnv override for
// this file — bosun is an ops tool (not a library) and must read its own env.
import { createLogger } from "@repo/logger";
import { makeDefaultFetcher, makeDefaultRunner, runProbes, summarizeVerify } from "./health.ts";

const [, , command, ...args] = process.argv;

// Root logger for the bosun process. pretty:false forces raw JSON regardless of
// NODE_ENV — the deploy agent must emit JSON in prod even when NODE_ENV is unset.
// See docs/logging.md §3.
const log = createLogger({ service: "bosun", pretty: false });

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
      // CC-fmws: the fresh-image one-shot deploy passes the webhook's digest map
      // as the positional `up` arg (JSON), so this inner `bosun up` still pins
      // every changed service by digest. Absent for an interactive `bosun up`.
      await cmdUp(parseOverridesArg(args[0]));
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
  // Usage text goes to stderr — structured logging is for runtime events, not
  // human-readable CLI help.
  process.stderr.write(
    [
      "Usage: bun run bosun <command>",
      "",
      "Commands:",
      "  plan          Evaluate deploy.config.ts and print the static Spec (no secrets)",
      "  secrets sync  Resolve secret refs and reconcile docker secrets",
      "  routes sync   Reconcile Cloudflare tunnel ingress + public DNS (proxied CNAME)",
      "  up            Full deploy: plan → secrets sync → stack deploy → routes+DNS sync → verify",
      "  verify        Run all declared health probes; exit 0 iff all pass",
      "  serve         Start the webhook receiver for CI-triggered deploys",
      "  run-job <name>  Fire one cronJob() now (same Swarm-job path the scheduler uses)",
      "",
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

// Parse the positional `up` arg (a JSON digest map) the fresh-image one-shot
// passes to the inner `bosun up`. Returns undefined for a missing or malformed
// value so a plain `bosun up` (operator at a terminal) is unaffected.
function parseOverridesArg(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Malformed — warn and deploy by :main tag rather than crash the deploy.
    log.warn({ raw }, "parseOverridesArg: malformed JSON arg, falling back to tag-based deploy");
  }
  return undefined;
}

// plan: evaluate the config and print the static Spec (no secret values).
async function cmdPlan(): Promise<void> {
  const spec = await loadSpec();
  process.stdout.write(`${JSON.stringify(spec, null, 2)}\n`);
}

// secrets sync: resolve refs via providers and reconcile docker secrets.
async function cmdSecrets(args: string[]): Promise<void> {
  if (args[0] !== "sync") {
    log.error({ usage: "bosun secrets sync" }, "secrets: missing subcommand");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");
  const { reconcileSecrets, pruneSecrets, makeDefaultDockerSecretClient } = await import(
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
  const { names, stale } = await reconcileSecrets(spec.stackName, resolved, client);
  // No deploy follows a standalone sync, so still-in-use secrets can't be removed
  // yet — pruneSecrets tolerates that and skips them (CC-8pt).
  await pruneSecrets(stale, client, makeStructuredPruneLogger(log));
  // Log secret names (docker hashed names, never values) so the operator can
  // verify which secrets are live.
  log.info(
    { step: "secrets", names: Object.keys(names), staleCount: stale.length },
    "secrets synced",
  );
}

// routes sync: reconcile Cloudflare tunnel routes (ingress) AND public DNS
// (proxied CNAME -> tunnel) from declared route: fields.
async function cmdRoutes(args: string[]): Promise<void> {
  if (args[0] !== "sync") {
    log.error({ usage: "bosun routes sync" }, "routes: missing subcommand");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  // Interactive `routes sync`: a CF failure must surface loudly (advisory: false).
  await reconcileCloudflare(spec, { advisory: false });
}

// Reconcile BOTH halves of the Cloudflare story so a service with a `route:`
// becomes publicly reachable on deploy with zero manual steps (CC-vqyv):
//   1. tunnel INGRESS rule  (hostname -> http://<service>:<port>)
//   2. public DNS  CNAME    (hostname -> <tunnelId>.cfargotunnel.com, proxied)
// The wildcard `*.worldwidewebb.co` is a dead A-record, so without (2) a new
// hostname 521s even with the ingress rule present (the drizzle failure).
//
// `advisory` mirrors verify's policy: the webhook deploy path passes true so a
// CF hiccup logs a warning but never aborts an otherwise-good stack deploy; the
// interactive path passes false so a failure exits non-zero.
async function reconcileCloudflare(
  spec: import("./spec.ts").Spec,
  opts: { advisory: boolean },
): Promise<void> {
  const {
    reconcileRoutes,
    reconcileDns,
    makeDefaultCloudflareRouteClient,
    makeDefaultCloudflareDnsClient,
    stackRouteTag,
    tunnelCnameTarget,
  } = await import("./reconcile/routes.ts");
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");

  // ACCOUNT_ID / ZONE_ID / TUNNEL_ID are non-secret identifiers supplied via env
  // (sourced through op -> the agent entrypoint). Missing config: advisory =>
  // warn + skip (a CF mis-config must not abort a deploy); interactive => exit
  // non-zero (a manual `routes sync` with no creds is an operator error).
  const accountId = process.env.CF_ACCOUNT_ID;
  const zoneId = process.env.CF_ZONE_ID;
  const tunnelId = process.env.CF_TUNNEL_ID;
  if (!accountId || !zoneId || !tunnelId) {
    const msg = "CF_ACCOUNT_ID, CF_ZONE_ID and CF_TUNNEL_ID must be set in the environment";
    if (opts.advisory) {
      log.warn({ step: "routes", advisory: true }, `skipping Cloudflare reconcile — ${msg}`);
      return;
    }
    log.error({ step: "routes" }, msg);
    process.exit(1);
  }

  // Map each declared hostname to its origin (http://<service>:<port>) so the
  // live client knows where to point a newly-created ingress rule.
  const originByHostname: Record<string, string> = {};
  for (const svc of spec.services) {
    if (svc.route) originByHostname[svc.route] = `http://${svc.name}:${svc.port ?? 80}`;
  }
  // Ownership for safe prune: a live route is ours iff its origin points at one
  // of this stack's services (CF ingress has no tag field). Cron jobs aren't
  // routable origins, so only real services count.
  const stackServiceNames = spec.services.filter((svc) => !svc.schedule).map((svc) => svc.name);
  const declared = spec.services.flatMap((svc) => (svc.route ? [svc.route] : []));
  const stackTag = stackRouteTag(spec.stackName);

  // Everything below does CF/op I/O. It ALL runs inside the advisory guard so
  // that on the webhook deploy path NO failure here (op token resolve, a CF API
  // hiccup, a prune list) can abort an otherwise-good stack deploy — only logs.
  // Interactive `routes sync` re-throws and exits non-zero.
  await runCloudflareStep(opts.advisory, "routes + DNS", async () => {
    const exec = await makeDefaultExec();
    const provider = new OpProvider(exec);
    const apiToken = await provider.resolve("op://Homelab/Cloudflare API/credential");

    const routeClient = makeDefaultCloudflareRouteClient(
      accountId,
      tunnelId,
      apiToken,
      (hostname) => originByHostname[hostname] ?? "",
      { stackTag, stackServiceNames },
    );
    const dnsClient = makeDefaultCloudflareDnsClient(zoneId, apiToken);

    // 1. Tunnel ingress.
    await reconcileRoutes(spec.stackName, declared, routeClient);
    log.info({ step: "routes", hostnames: declared }, "routes synced");

    // 2. Public DNS. Prune ownership: a CNAME is eligible for prune only if its
    // hostname is one this stack OWNS as a tunnel ingress route (origin = a stack
    // service) — never a foreign hostname that merely shares our tunnel target
    // (e.g. `portainer`). Read live ingress AFTER reconcileRoutes, then union
    // with the declared set so a hostname we just removed from ingress still
    // counts as ours and its stale CNAME gets pruned too.
    const ownedHostnames = (await routeClient.listRoutes())
      .filter((r) => r.tags.includes(stackTag))
      .map((r) => r.hostname);
    const dnsOwned = new Set([...ownedHostnames, ...declared]);
    await reconcileDns(declared, tunnelCnameTarget(tunnelId), dnsClient, dnsOwned);
    log.info({ step: "routes", hostnames: declared }, "DNS synced");
  });
}

// Run one Cloudflare reconcile step. Advisory (deploy path): swallow + warn so a
// CF hiccup never aborts an otherwise-good deploy, exactly like verify (CC-vqyv).
// Interactive: let the error throw out so `routes sync` exits non-zero.
async function runCloudflareStep(
  advisory: boolean,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (!advisory) throw err;
    log.warn(
      { step: "routes", label, err, advisory: true },
      "Cloudflare reconcile failed (advisory, deploy continues)",
    );
  }
}

// up: plan → secrets sync → docker stack deploy → Cloudflare routes+DNS sync →
// verify. Routes+DNS run AFTER the stack deploy so the origin services exist
// before we publish their hostnames; both are advisory on the webhook path so a
// CF hiccup never aborts an otherwise-good deploy (CC-vqyv).
// `imageOverrides` (from the deploy webhook body) pins our ghcr images to the
// exact digests CI built, so the stack deploy reliably rolls changed services
// instead of depending on :main tag re-resolution (CC-czg).
async function cmdUp(
  imageOverrides?: Record<string, string>,
  // Verify policy. The interactive `up` (operator at a terminal) fails on a red
  // verify so a broken deploy is loud. The webhook serve path passes true: the
  // stack deploy already succeeded, and probes that are merely not-yet-warm
  // (cold climate endpoint, etc.) must not make it look like a deploy error
  // (CC-1dx). The verify still runs and logs in both cases. The same flag gates
  // the Cloudflare routes/DNS reconcile (advisory on the webhook path).
  opts: { advisoryVerify?: boolean } = {},
): Promise<void> {
  const deployLog = log.child({ step: "deploy" });

  deployLog.info({}, "loading config");
  if (imageOverrides && Object.keys(imageOverrides).length > 0) {
    // Log only the image names (keys), never digest values — they are not
    // secrets but keeping this log tight makes the pattern clear.
    deployLog.info({ imageKeys: Object.keys(imageOverrides) }, "pinning images by digest");
  }
  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };

  deployLog.info({}, "syncing secrets");
  const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");
  const { reconcileSecrets, pruneSecrets, makeDefaultDockerSecretClient } = await import(
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
  const { names: secretNames, stale: staleSecrets } = await reconcileSecrets(
    spec.stackName,
    resolved,
    secretClient,
  );
  // Log created names (docker hashed names) and stale count — never the values.
  deployLog.info(
    { secretNames: Object.keys(secretNames), staleCount: staleSecrets.length },
    "secrets reconciled",
  );

  deployLog.info({}, "rendering stack and deploying");
  const { renderStackYml, deployStack } = await import("./reconcile/stack.ts");
  const yml = renderStackYml(spec, secretNames, imageOverrides);
  const t0 = Date.now();
  const deployOut = await deployStack(spec.stackName, yml);
  const durationMs = Date.now() - t0;
  deployLog.info({ durationMs, stdout: deployOut || undefined }, "stack deployed");

  // Prune stale secrets ONLY after the stack has redeployed off them — a rename
  // (e.g. cc_ -> control-center_) leaves the old secret in use until this deploy
  // re-points services, so pruning earlier would refuse + abort the deploy (CC-8pt).
  await pruneSecrets(staleSecrets, secretClient, makeStructuredPruneLogger(deployLog));

  // Reconcile Cloudflare tunnel ingress + public DNS so a service that declares
  // a `route:` is publicly reachable with no manual CF steps (CC-vqyv). Runs
  // after the deploy (origins must exist first) and is advisory on the webhook
  // path — a CF failure logs but never fails the deploy, like verify below.
  deployLog.info({}, "reconciling Cloudflare routes + DNS");
  await reconcileCloudflare(spec, { advisory: opts.advisoryVerify ?? false });

  deployLog.info({}, "verifying");
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
  // summarizeVerify returns human-readable lines for operator terminals.
  // Also log the outcome as a structured event so it appears in the agent's
  // prod JSON stream.
  log.info(
    {
      step: "verify",
      passed: result.results.filter((r) => r.pass).length,
      total: result.results.length,
      failed,
    },
    "verify complete",
  );
  for (const line of lines) process.stdout.write(`${line}\n`);

  // Advisory (serve path): never exit — a not-yet-warm probe must not look like a
  // failed deploy (CC-1dx). Interactive `up`/`verify`: exit non-zero so a broken
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
    log.error({ step: "serve" }, "BOSUN_WEBHOOK_TOKEN must be set");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { handleServeRequest, runWebhookDeploy } = await import("./serve.ts");

  // Start the in-process cron scheduler. This agent is the long-lived process on
  // a manager node with the docker socket, so it runs each cronJob() on its
  // schedule as a one-shot Swarm job — replacing the old third-party scheduler pod.
  const { startScheduler } = await import("./scheduler.ts");
  const schedulerLog = log.child({ step: "scheduler" });
  // A cron job may declare op secrets (the cert job's Cloudflare token for
  // DNS-01); the scheduler resolves them at dispatch via the agent's OpProvider.
  // Reuse one serialized provider so concurrent reads can't race op's daemon
  // init (same reason cmdUp uses a single OpProvider).
  const { makeDefaultExec: makeSchedulerExec, OpProvider: SchedulerOpProvider } = await import(
    "./providers/op.ts"
  );
  const schedulerProvider = new SchedulerOpProvider(await makeSchedulerExec(), schedulerLog);
  const stopScheduler = startScheduler(
    spec.services,
    spec.stackName,
    makeDefaultRunner(),
    schedulerLog,
    (ref) => schedulerProvider.resolve(ref),
  );

  const cronJobs = spec.services.filter((svc) => svc.schedule).map((svc) => svc.name);

  // SIGTERM/SIGINT: log shutdown + stop the scheduler interval cleanly before
  // the process exits. Without this the interval fires once more and prints
  // an error because the docker socket is gone.
  const handleShutdown = (signal: string): void => {
    log.info({ step: "serve", signal }, "bosun shutting down");
    stopScheduler();
    process.exit(0);
  };
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));

  // Startup line — the liveness anchor in `docker service logs`. An operator
  // greps this first to confirm the agent booted and configured its logger.
  log.info({ step: "serve", stack: spec.stackName, port, cronJobs }, "bosun started");

  const runner = makeDefaultRunner();
  Bun.serve({
    port,
    fetch(req) {
      return handleServeRequest(req, {
        stackName: spec.stackName,
        token,
        // Run deploy in the background; the handler responds 202 immediately.
        // CC-fmws: runWebhookDeploy launches the FRESH bosun image as a one-shot
        // (new config + builders in one deploy), falling back to in-process cmdUp
        // when the payload carries no bosun digest.
        onDeploy: (imageOverrides) =>
          runWebhookDeploy(imageOverrides, {
            stackName: spec.stackName,
            runner,
            inProcessUp: (o) => cmdUp(o, { advisoryVerify: true }),
            log: makeStructuredServeLogger(log),
            env: process.env,
          }).catch((err) => log.error({ step: "serve", err }, "deploy error")),
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
    log.error({ usage: "bosun run-job <name>" }, "run-job: missing job name");
    process.exit(1);
  }

  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const { selectCronJob, buildJobCommand, jobServiceName } = await import("./scheduler.ts");

  // Throws a clear error (unknown name / not a cron job) before touching docker.
  const job = selectCronJob(spec.services, name);
  const svc = jobServiceName(spec.stackName, name);

  // Resolve the job's op secrets (if any) the SAME way the scheduler does, so a
  // manual run-job is byte-identical to a scheduled run (CC-q002.13). The ref
  // path is logged on failure, never the value.
  let resolvedSecrets: Record<string, string> | undefined;
  if (job.secrets.length > 0) {
    const { makeDefaultExec, OpProvider } = await import("./providers/op.ts");
    const provider = new OpProvider(await makeDefaultExec(), log.child({ step: "run-job" }));
    resolvedSecrets = {};
    for (const sec of job.secrets) {
      resolvedSecrets[sec.name] = await provider.resolve(sec.ref);
    }
  }
  const cmd = buildJobCommand(job, spec.stackName, undefined, resolvedSecrets);

  log.info({ step: "run-job", name, svc }, "firing cron job as Swarm job");
  const { exitCode } = await makeDefaultRunner()(cmd);
  if (exitCode !== 0) {
    log.error({ step: "run-job", name, exitCode }, "run-job service create failed");
    process.exit(exitCode);
  }
  log.info({ step: "run-job", name, svc }, "cron job dispatched");
}

// Build a string-message logger from the structured log for the pruneSecrets
// callback. Logs deferred prune messages at warn level (the secret is still
// in use — recoverable, not pages-worthy).
function makeStructuredPruneLogger(
  parentLog: import("@repo/logger").Logger,
): (msg: string) => void {
  return (msg: string) => {
    // Extract the docker secret name from the deferred-prune message format.
    parentLog.warn({ step: "secrets" }, msg);
  };
}

// Build the string-message logger for runWebhookDeploy. Maps to the structured
// log at info level — these are lifecycle messages (one-shot exit, path chosen).
function makeStructuredServeLogger(
  parentLog: import("@repo/logger").Logger,
): (msg: string) => void {
  return (msg: string) => {
    parentLog.info({ step: "serve" }, msg);
  };
}

main().catch((err) => {
  // Log the full error object (stack + message) so the exact failure site is
  // visible in the agent's JSON log stream, not just the message string.
  log.error({ err }, "bosun command failed");
  process.exit(1);
});
