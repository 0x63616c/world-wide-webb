// Static, pure data types for a bosun Spec. No I/O, no side effects.
// Configs import and return these; the tool consumes them at sync time.

export interface SecretRef {
  // Secret name as it will appear inside the container (e.g. "HA_TOKEN").
  name: string;
  // Provider reference resolved at sync time (e.g. "op://Homelab/Item/field").
  ref: string;
}

/** @public — part of the bosun deploy-spec surface (deploy.config.ts); kept though no internal consumer yet (www-k6p1). */
export interface ScheduleSpec {
  // Standard 5-field cron ("min hour dom mon dow"). The bosun scheduler matches
  // it against the wall clock each minute; no seconds column to track.
  cron: string;
}

export interface HealthProbe {
  kind: "http" | "cmd";
  // Human-readable label used in verify output.
  description: string;
  // For http: the URL to check.
  url?: string;
  // Expected HTTP status code for http probes.
  expectedStatus?: number;
  // For cmd: the shell command to run; exits 0 = pass.
  command?: string;
}

export interface HealthcheckSpec {
  // Shell command run INSIDE the container; exit 0 = healthy. Rendered in docker's
  // CMD-SHELL form (run via /bin/sh -c). This is distinct from `health` probes,
  // which bosun runs from the DEPLOY HOST to verify a deploy; a healthcheck makes
  // the swarm itself track container liveness (State.Health.Status) and gates
  // rolling updates on it.
  test: string;
  // Compose duration strings (e.g. "30s"). Defaults applied by the renderer.
  interval?: string;
  timeout?: string;
  retries?: number;
  startPeriod?: string;
}

export interface ServiceSpec {
  name: string;
  image: string;
  // Declared docker secret references. Resolved values never appear here.
  secrets: SecretRef[];
  // Static env vars (non-secret). No values from providers.
  env: Record<string, string>;
  // Optional: public Cloudflare hostname to route to this service.
  route?: string;
  // Optional: port this service listens on (default 80).
  port?: number;
  // Optional: proxy /api requests to this target (for the web service).
  proxyApiTo?: string;
  // Optional shell command override for the container.
  command?: string;
  // Optional bind/volume mounts ("source:target" docker syntax). Used by infra
  // services (and cron jobs) that need the docker socket.
  volumes?: string[];
  // Optional deploy placement constraints (e.g. "node.role==manager").
  placement?: string[];
  // Optional explicit replica count (deploy.replicas). Swarm defaults a long-lived
  // service to 1 when unset, so leave it undefined for the normal case. Set to 0 to
  // PARK a service in the spec (deployed but scaled to zero) — durable across the
  // whole-stack redeploy on every push, unlike a manual `docker service scale`.
  replicas?: number;
  // Optional scheduled-job declaration. When present this service is NOT a
  // long-lived swarm service: the bosun scheduler (in `bosun serve`) runs it on
  // its cron as a one-shot Swarm job (docker service create --mode
  // replicated-job), so renderStackYml excludes it from the deployed stack. A
  // one-shot job has no liveness endpoint, so cronJob() attaches no probes.
  schedule?: ScheduleSpec;
  // Optional Docker container healthcheck (swarm-tracked liveness). See above.
  healthcheck?: HealthcheckSpec;
  health: HealthProbe[];
}

export interface Spec {
  // Stack name used for Docker Swarm stack deploy and label scoping.
  stackName: string;
  services: ServiceSpec[];
}

// --- Builder helpers (imported by deploy.config.ts) ---

export function stack(name: string, opts: { services: ServiceSpec[] }): Spec {
  return { stackName: name, services: opts.services };
}

export function service(
  name: string,
  opts: Partial<Omit<ServiceSpec, "name" | "secrets" | "env" | "health">> & {
    secrets?: SecretRef[];
    env?: Record<string, string>;
    health?: HealthProbe[];
  },
): ServiceSpec {
  return {
    name,
    image: opts.image ?? "",
    secrets: opts.secrets ?? [],
    env: opts.env ?? {},
    route: opts.route,
    port: opts.port,
    proxyApiTo: opts.proxyApiTo,
    command: opts.command,
    volumes: opts.volumes,
    placement: opts.placement,
    replicas: opts.replicas,
    schedule: opts.schedule,
    healthcheck: opts.healthcheck,
    health: opts.health ?? [],
  };
}

// Container healthcheck builder. `test` is a shell command run inside the
// container (exit 0 = healthy). Durations use compose strings; the renderer
// supplies sane defaults (30s/5s/3/20s) for any field left unset.
export function healthcheck(
  test: string,
  opts: Partial<Omit<HealthcheckSpec, "test">> = {},
): HealthcheckSpec {
  return { test, ...opts };
}

// Scheduled-job primitive. A cron job is a ServiceSpec carrying a `schedule`,
// but it is NOT deployed as a long-lived stack service — the bosun scheduler
// runs it on its cron as a one-shot Swarm job (docker service create --mode
// replicated-job), so renderStackYml excludes it from the rendered stack. A
// one-shot job has no liveness endpoint, so it attaches no health probes (jobs
// are exempt from verify — a one-shot has nothing to poll). `placement` pins the
// job to a node class (e.g. node.role==manager for socket-mounting jobs).
export function cronJob(
  name: string,
  opts: {
    image: string;
    // Standard 5-field cron ("min hour dom mon dow"). Matched on the wall clock.
    schedule: string;
    command: string;
    env?: Record<string, string>;
    volumes?: string[];
    placement?: string[];
  },
): ServiceSpec {
  const cron = opts.schedule.trim();
  if (cron.split(/\s+/).length !== 5) {
    throw new Error(
      `cronJob '${name}': schedule must be standard 5-field cron, got '${opts.schedule}'`,
    );
  }
  return {
    name,
    image: opts.image,
    secrets: [],
    env: opts.env ?? {},
    command: opts.command,
    volumes: opts.volumes,
    placement: opts.placement,
    schedule: { cron },
    // No probes: jobs are exempt from liveness verify.
    health: [],
  };
}

export function fromOp(vault: string, refs: Record<string, string>): SecretRef[] {
  return Object.entries(refs).map(([name, item]) => ({
    name,
    ref: `op://${vault}/${item}`,
  }));
}

export function ghcr(imageName: string, tag = "main"): string {
  return `ghcr.io/0x63616c/${imageName}:${tag}`;
}

export function httpProbe(url: string, expectedStatus: number): HealthProbe {
  return {
    kind: "http",
    description: `HTTP ${expectedStatus} from ${url}`,
    url,
    expectedStatus,
  };
}

export function cmdProbe(description: string, command: string): HealthProbe {
  return { kind: "cmd", description, command };
}

// cert-expiry lookahead probe. Connect-time TLS validation (an http probe) only
// fails AFTER a cert has already expired — too late to act. This wraps openssl's
// -checkend, which exits non-zero when the cert expires within `warnDays`, so the
// probe goes red BEFORE expiry while there is still time to renew. Implemented on
// the existing cmd path so no new probe kind is needed.
export function certProbe(
  host: string,
  opts: { warnDays: number; port?: number } = { warnDays: 14 },
): HealthProbe {
  const port = opts.port ?? 443;
  const seconds = opts.warnDays * 86400;
  // s_client opens the TLS session; x509 -checkend asserts the leaf cert stays
  // valid for `seconds` from now. SNI (-servername) is required for hosts behind
  // virtual hosting / SNI-based routing to return the right cert.
  const command =
    `echo | openssl s_client -connect ${host}:${port} -servername ${host} 2>/dev/null` +
    ` | openssl x509 -checkend ${seconds} -noout`;
  return {
    kind: "cmd",
    description: `cert for ${host}:${port} valid >${opts.warnDays}d`,
    command,
  };
}

// postgres convenience builder — produces a ServiceSpec for Postgres.
//
// NOTE: custom postgresql.conf / initdb mounting is intentionally NOT supported.
// An earlier version accepted `config`/`init` path options, but the renderer
// never emitted them and the bosun-agent image never copied the `infra/` tree —
// so they were a silent no-op that misrepresented the deployed stack. They were
// removed (www-355t.4). If config/init mounting is ever needed, add it to the
// renderer (reconcile/stack.ts) AND copy the files into the agent image, with a
// rendered-plan snapshot test asserting they reach the output.
export function postgres(opts: {
  volume: string;
  image?: string;
  secretRef?: string;
  // Database created on a FRESH volume init. Defaults to the api's expected db
  // name (apps/api/src/env.ts: POSTGRES_DB ?? "control_center"). POSTGRES_DB is
  // honoured by the postgres image ONLY on first init, so it is inert against an
  // existing data volume — safe to add to the live spec without forcing a
  // destructive re-init, while a volume-loss rebuild correctly recreates it.
  db?: string;
}): ServiceSpec {
  return {
    name: "postgres",
    image: opts.image ?? "postgres:17-alpine",
    secrets: opts.secretRef ? [{ name: "POSTGRES_PASSWORD", ref: opts.secretRef }] : [],
    // POSTGRES_DB names the database created on a fresh init (always set, so a
    // rebuilt volume matches what the api connects to). The superuser password is
    // read from the mounted secret FILE so the value never lands in the service
    // env/spec; POSTGRES_PASSWORD_FILE is omitted in dev/test (no secretRef).
    env: {
      POSTGRES_DB: opts.db ?? "control_center",
      ...(opts.secretRef ? { POSTGRES_PASSWORD_FILE: "/run/secrets/POSTGRES_PASSWORD" } : {}),
    },
    // Persist the data dir on the named volume, or every redeploy starts from an
    // empty database. The renderer pins this to the managed <stack>_<volume> volume.
    volumes: [`${opts.volume}:/var/lib/postgresql/data`],
    // Swarm-tracked container liveness. pg_isready ships in the postgres image and
    // is the canonical readiness check; start_period covers first-init/recovery.
    // No -h: this runs INSIDE the postgres container, so localhost is correct.
    healthcheck: healthcheck("pg_isready -U postgres", { startPeriod: "30s" }),
    // The deploy-verify probe runs in the bosun AGENT, not in postgres, so it must
    // target the service over the overlay network (-h postgres) — without it,
    // pg_isready checks the agent's own localhost and always exits 2 (www-hya3).
    health: [cmdProbe("postgres ready", "pg_isready -h postgres -U postgres")],
  };
}
