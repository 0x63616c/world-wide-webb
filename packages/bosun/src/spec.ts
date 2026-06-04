// Static, pure data types for a bosun Spec. No I/O, no side effects.
// Configs import and return these; the tool consumes them at sync time.

export interface SecretRef {
  // Secret name as it will appear inside the container (e.g. "HA_TOKEN").
  name: string;
  // Provider reference resolved at sync time (e.g. "op://Homelab/Item/field").
  ref: string;
}

// Ofelia job types. job-exec runs inside an already-running container (e.g. a
// migration against the live app); job-run spins up a fresh one-shot container
// (e.g. a prune). Both are node-local — they only see the daemon Ofelia is
// attached to — which is fine on our single-node swarm. job-service-run (a
// one-off Swarm service) would be needed for multi-node, out of scope here.
export type OfeliaJobType = "job-exec" | "job-run";

export interface ScheduleSpec {
  // Standard 5-field cron ("min hour dom mon dow"). Translated to Ofelia's
  // 6-field (seconds-leading) format at render time by prepending "0 ", so
  // specs stay conventional and nobody has to remember the seconds column.
  cron: string;
  jobType: OfeliaJobType;
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
  // services like the Ofelia controller that need the docker socket.
  volumes?: string[];
  // Optional deploy placement constraints (e.g. "node.role==manager").
  placement?: string[];
  // Optional scheduled-job declaration. When present this service is driven by
  // the Ofelia scheduler via ofelia.* deploy labels rather than running as a
  // long-lived service. A one-shot job has no liveness endpoint, so an http
  // HealthProbe on it is rejected by cronJob().
  schedule?: ScheduleSpec;
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
    schedule: opts.schedule,
    health: opts.health ?? [],
  };
}

// Scheduled-job primitive. A job is a normal ServiceSpec carrying a `schedule`,
// so it reuses the existing secret/env/command rendering and gets op-resolved
// secrets for free. A one-shot job has no liveness endpoint, so an http
// HealthProbe is nonsensical and rejected here at build time. cmd probes are
// also rejected: jobs are exempt from verify (a one-shot has nothing to poll).
// A future last-run-exit-0 check could query Ofelia's last task state instead.
export function cronJob(
  name: string,
  opts: {
    image: string;
    // Standard 5-field cron, translated to Ofelia 6-field at render time.
    schedule: string;
    command: string;
    secrets?: SecretRef[];
    env?: Record<string, string>;
    jobType?: OfeliaJobType;
    volumes?: string[];
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
    secrets: opts.secrets ?? [],
    env: opts.env ?? {},
    command: opts.command,
    volumes: opts.volumes,
    schedule: { cron, jobType: opts.jobType ?? "job-run" },
    // No probes: jobs are exempt from liveness verify.
    health: [],
  };
}

// The Ofelia scheduler itself, declared as bosun-managed infra so it is
// reconciled like any other service rather than hand-placed. It reads job
// schedules from the ofelia.* deploy labels other services emit. Needs the
// docker socket (root-equivalent) to spawn/exec containers and must sit on a
// manager node. This socket mount + single-controller design is a deliberate
// SPOF tradeoff, acceptable for the single-node homelab swarm.
export function ofeliaController(opts: { image?: string } = {}): ServiceSpec {
  return {
    name: "ofelia",
    image: opts.image ?? "mcuadros/ofelia:latest",
    secrets: [],
    env: {},
    command: "daemon --docker",
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"],
    placement: ["node.role==manager"],
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
export function postgres(opts: {
  volume: string;
  // docker config source paths to mount at /etc/postgresql/postgresql.conf
  config?: string[];
  // initdb script paths to mount at /docker-entrypoint-initdb.d/
  init?: string[];
  image?: string;
  secretRef?: string;
}): ServiceSpec {
  return {
    name: "postgres",
    image: opts.image ?? "postgres:17-alpine",
    secrets: opts.secretRef ? [{ name: "POSTGRES_PASSWORD", ref: opts.secretRef }] : [],
    // Read the superuser password from the mounted secret file so the value
    // never lands in the service env/spec. Omitted in dev/test (no secretRef).
    env: opts.secretRef ? { POSTGRES_PASSWORD_FILE: "/run/secrets/POSTGRES_PASSWORD" } : {},
    // Persist the data dir on the named volume, or every redeploy starts from an
    // empty database. The renderer pins this to the managed cc_<volume> volume.
    volumes: [`${opts.volume}:/var/lib/postgresql/data`],
    health: [cmdProbe("postgres ready", "pg_isready -U postgres")],
  };
}
