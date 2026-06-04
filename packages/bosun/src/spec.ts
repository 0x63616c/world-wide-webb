// Static, pure data types for a bosun Spec. No I/O, no side effects.
// Configs import and return these; the tool consumes them at sync time.

export interface SecretRef {
  // Secret name as it will appear inside the container (e.g. "HA_TOKEN").
  name: string;
  // Provider reference resolved at sync time (e.g. "op://Homelab/Item/field").
  ref: string;
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
    health: opts.health ?? [],
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
    env: {},
    health: [cmdProbe("postgres ready", "pg_isready -U postgres")],
  };
}
