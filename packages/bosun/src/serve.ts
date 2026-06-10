// Pure request handler for the bosun deploy webhook receiver. cli.ts `serve`
// wires this into Bun.serve with the real deploy trigger; keeping it pure makes
// the auth + routing logic unit-testable without binding a socket or shelling
// out to a real `bosun up`.

import type { Runner } from "./health.ts";
// serve.ts deliberately has no process.env reads and no direct logger creation ,
// it is pure (injected deps only) so it stays unit-testable. The log callback is
// the injection point; cli.ts wires the real pino logger via makeStructuredServeLogger.

export interface ServeOptions {
  // Stack this receiver deploys. The deploy path is namespaced by it so the
  // shared hooks.worldwidewebb.co host can front many projects.
  stackName: string;
  // Shared secret the CI caller must present as `Authorization: Bearer <token>`.
  token: string;
  // Trigger a deploy (`bosun up`). Injected so tests don't run a real deploy.
  // Trigger a deploy (`bosun up`). Injected so tests don't run a real deploy.
  // `imageOverrides` is the per-image digest map from the request body (CC-czg);
  // undefined when the caller sends no/invalid JSON body (legacy/manual).
  onDeploy: (imageOverrides?: Record<string, string>) => void;
}

export async function handleServeRequest(req: Request, opts: ServeOptions): Promise<Response> {
  const url = new URL(req.url);

  // Health check, no auth. Used by the service's httpProbe and CF.
  if (req.method === "GET" && url.pathname === "/up") {
    return new Response("ok", { status: 200 });
  }

  // Deploy endpoint, bearer auth. Path is /deploy/<stack> to match the CI
  // caller (POST https://hooks.worldwidewebb.co/deploy/control-center) and to
  // keep the hooks host multi-project shaped.
  if (req.method === "POST" && url.pathname === `/deploy/${opts.stackName}`) {
    const auth = req.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${opts.token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    // The CI caller sends {"images": {"<ghcr-name>": "sha256:..."}} so the deploy
    // can pin images by digest (CC-czg). A missing or non-JSON body yields
    // undefined overrides, the legacy behaviour (deploy by :main tag).
    const images = await parseImageOverrides(req);
    // Fire-and-forget: respond immediately so the caller doesn't wait for the
    // full deploy (which can take minutes) and time out.
    opts.onDeploy(images);
    return new Response("Deploy triggered", { status: 202 });
  }

  return new Response("Not Found", { status: 404 });
}

// The ghcr image name (key in the webhook digest map, and `ghcr()` arg in
// deploy.config.ts) of the bosun-agent's OWN image. The fresh-image one-shot
// (below) runs THIS image at the digest CI just built.
export const BOSUN_IMAGE_NAME = "control-center-bosun";

// Config the one-shot deploy needs from the resident agent's runtime.
export interface DeployCommandConfig {
  // Stack to deploy (passed through to the inner `bosun up` via cwd config).
  stackName: string;
  // Host docker socket path; bind-mounted into the one-shot so the inner
  // `bosun up` can `docker stack deploy` / `docker secret` against the daemon.
  dockerSocket: string;
  // Env var names to forward from the agent into the one-shot, in order. Only
  // the ones actually set on the agent (`env`) are emitted.
  passEnv: string[];
  // The agent's current environment (process.env), read for `passEnv` values.
  env: Record<string, string | undefined>;
}

// CC-fmws: build the `docker run` that deploys via the FRESHLY-BUILT bosun image
// instead of rendering from the deploy.config.ts baked into the resident agent's
// OWN (one-version-behind) image. The webhook payload already carries the new
// `control-center-bosun` digest, so we run THAT image's `bosun up`, which loads
// the NEW deploy.config.ts AND the NEW builders (spec.ts), fixing both config
// staleness and builder-version skew in a single deploy.
//
// Returns a single shell command string for the injected Runner (same `sh -c`
// Runner the scheduler/health probes use). Returns null when the payload lacks
// the bosun digest (manual/legacy callers): the caller then falls back to the
// in-process `bosun up` so a no-body deploy still works.
//
// The one-shot uses the image's NORMAL entrypoint with `up <payload>` as args
// (the entrypoint dispatches on args: present -> `bun cli.ts "$@"`, absent ->
// `serve`). Running the normal entrypoint is deliberate, it exports the env
// secrets only when the matching /run/secrets file exists (so our `-e NAME`
// pass-through survives in the one-shot, which mounts no secret files) AND it
// performs the `docker login ghcr.io` (from the forwarded GHCR_PULL_TOKEN) that
// makes the inner `bosun up`'s `docker stack deploy --with-registry-auth` carry
// valid pull creds. The full digest map is the positional `up` arg (JSON), so
// digest-pinning of EVERY service is preserved.
export function buildDeployCommand(
  imageOverrides: Record<string, string> | undefined,
  config: DeployCommandConfig,
): string | null {
  const digest = imageOverrides?.[BOSUN_IMAGE_NAME];
  if (!digest) return null;

  const image = `ghcr.io/0x63616c/${BOSUN_IMAGE_NAME}@${digest}`;
  const sock = config.dockerSocket;

  const parts = ["docker run", "--rm", `-v ${sock}:${sock}`];
  // Name-only `-e NAME` forwards each var's VALUE from the resident agent's env
  // (its entrypoint already exported them from /run/secrets). Only vars actually
  // set on the agent are forwarded, no empty `-e NAME=`.
  for (const name of config.passEnv) {
    if (config.env[name] !== undefined) parts.push(`-e ${name}`);
  }
  // Normal entrypoint + `up <payload>`. The digest map rides as the positional
  // arg so the inner `bosun up` pins every changed service exactly as the
  // in-process path did. Single-quoted so the JSON survives the `sh -c` Runner.
  parts.push(image, "up", shellSingleQuote(JSON.stringify(imageOverrides)));

  return parts.join(" ");
}

// Wrap a value in single quotes for `sh -c`, escaping any embedded single quote
// the POSIX way ('\'' = close, literal quote, reopen).
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Dependencies the serve path injects so this is exercised without a real
// docker run or a real in-process deploy.
export interface WebhookDeployDeps {
  stackName: string;
  // Runs the one-shot `docker run` (same `sh -c` Runner the scheduler uses).
  runner: Runner;
  // The legacy in-process `bosun up`, called when the payload has no fresh bosun
  // image to roll to (manual/legacy callers). cli.ts passes the advisory-verify
  // flavour so a not-yet-warm probe doesn't look like a deploy error (CC-1dx).
  inProcessUp: (imageOverrides?: Record<string, string>) => Promise<void>;
  log?: (msg: string) => void;
  // The agent's environment (cli.ts passes process.env, the sanctioned reader).
  // Only the ONE_SHOT_PASS_ENV vars actually set here are forwarded into the
  // one-shot. Kept out of serve.ts so this module never touches process.env.
  env: Record<string, string | undefined>;
}

// Env the inner `bosun up` needs to resolve secrets (op), log in to ghcr, and
// sync CF routes + Access. Forwarded into the one-shot only when set on the agent.
const ONE_SHOT_PASS_ENV = [
  "OP_SERVICE_ACCOUNT_TOKEN",
  "GHCR_PULL_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_ZONE_ID",
  "CF_TUNNEL_ID",
  // CF Access reconcile (CC-cuuw): the inner `bosun up` resolves the allowed
  // email (emailEnv rules) + service-token client-ids from these. Without them
  // forwarded, reconcileAccess throws on the emailEnv rule and (advisory) creates
  // no Access apps, so the storybook/drizzle gating silently never applies.
  "CF_ACCESS_ALLOWED_EMAIL",
  "CF_ACCESS_KIOSK_CLIENT_ID",
  "CF_ACCESS_CI_CLIENT_ID",
];

// Decide how to run a webhook-triggered deploy (CC-fmws). Preferred path: a
// one-shot `docker run` of the FRESHLY-BUILT bosun image (digest in the webhook
// payload), so the NEW deploy.config.ts AND NEW builders apply in ONE deploy
// instead of rendering from the resident agent's stale baked-in config. Falls
// back to the legacy in-process `bosun up` when the payload carries no bosun
// digest (manual/legacy callers POST no body), that path can't be stale anyway,
// since there is no new image to roll to.
//
// Verify semantics differ by path, intentionally. The in-process fallback keeps
// the advisory verify (a not-yet-warm probe must not look like a deploy error,
// CC-1dx). The one-shot runs a plain `bosun up`, which fails loudly on a red
// verify, acceptable, because the stack deploy has already applied by the time
// verify runs (it is the last step), so a non-zero exit means a genuinely broken
// deploy worth surfacing, not a swallowed success.
export async function runWebhookDeploy(
  imageOverrides: Record<string, string> | undefined,
  deps: WebhookDeployDeps,
): Promise<void> {
  const log = deps.log ?? (() => {});
  const cmd = buildDeployCommand(imageOverrides, {
    stackName: deps.stackName,
    dockerSocket: "/var/run/docker.sock",
    passEnv: ONE_SHOT_PASS_ENV,
    env: deps.env,
  });

  if (!cmd) {
    log("[bosun serve] no bosun digest in payload; deploying in-process");
    await deps.inProcessUp(imageOverrides);
    return;
  }

  log(`[bosun serve] deploying via fresh-image one-shot: ${cmd}`);
  const { exitCode } = await deps.runner(cmd);
  if (exitCode !== 0) {
    throw new Error(`fresh-image deploy one-shot exited ${exitCode}`);
  }
}

// Extract the {"images": {...}} digest map from the request body, tolerating a
// missing/empty/invalid body (returns undefined) so legacy/manual callers that
// POST no body still trigger a normal deploy.
async function parseImageOverrides(req: Request): Promise<Record<string, string> | undefined> {
  try {
    const body = (await req.json()) as { images?: unknown };
    if (body && typeof body.images === "object" && body.images !== null) {
      return body.images as Record<string, string>;
    }
  } catch {
    // No body / not JSON, fall through to undefined.
  }
  return undefined;
}
