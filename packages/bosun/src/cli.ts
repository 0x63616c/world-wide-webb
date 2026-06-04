// Command dispatcher for the bosun CLI.
// Entry point: `bun run bosun <cmd>` (root package.json "bosun" script).
import { formatReport, makeDefaultFetcher, makeDefaultRunner, runProbes } from "./health.ts";

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
  const { reconcileRoutes, makeDefaultCloudflareRouteClient } = await import(
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

  const client = makeDefaultCloudflareRouteClient(accountId, tunnelId, apiToken);
  const declared = spec.services.flatMap((svc) => (svc.route ? [svc.route] : []));
  await reconcileRoutes(spec.stackName, declared, client);
  console.log("Routes synced:", declared);
}

// up: plan → secrets sync → routes sync → docker stack deploy → verify.
async function cmdUp(): Promise<void> {
  console.log("[bosun up] Loading config...");
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
  const yml = renderStackYml(spec, secretNames);
  const deployOut = await deployStack(spec.stackName, yml);
  if (deployOut) console.log(deployOut);

  console.log("[bosun up] Verifying...");
  await runVerify(spec.services.flatMap((svc) => svc.health));
}

// verify: run all declared health probes; exit 0 iff all pass.
async function cmdVerify(): Promise<void> {
  const { default: spec } = (await import(`${process.cwd()}/deploy.config.ts`)) as {
    default: import("./spec.ts").Spec;
  };
  const probes = spec.services.flatMap((svc) => svc.health);
  await runVerify(probes);
}

async function runVerify(probes: import("./spec.ts").HealthProbe[]): Promise<void> {
  const result = await runProbes(probes, {
    fetcher: makeDefaultFetcher(),
    runner: makeDefaultRunner(),
  });

  console.log(
    `\nHealth probes: ${result.results.filter((r) => r.pass).length}/${result.results.length} passed`,
  );
  console.log(formatReport(result.results));

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

// serve: start the webhook receiver that runs `up` on authenticated POST.
async function cmdServe(): Promise<void> {
  const port = Number(process.env.BOSUN_PORT ?? 4202);
  const token = process.env.BOSUN_WEBHOOK_TOKEN;
  if (!token) {
    console.error("BOSUN_WEBHOOK_TOKEN must be set");
    process.exit(1);
  }

  console.log(`[bosun serve] Listening on :${port}`);

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Health check endpoint — no auth required.
      if (req.method === "GET" && url.pathname === "/up") {
        return new Response("ok", { status: 200 });
      }

      // Deploy endpoint — bearer token auth.
      if (req.method === "POST" && url.pathname === "/deploy") {
        const auth = req.headers.get("Authorization") ?? "";
        if (auth !== `Bearer ${token}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        // Run deploy in the background; respond immediately so the caller
        // doesn't wait for the full deploy to time out.
        cmdUp().catch((err) => console.error("[bosun serve] deploy error:", err));
        return new Response("Deploy triggered", { status: 202 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
