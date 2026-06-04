// Typed builder API for bosun deploy configs.
// All builders return plain data structures — zero I/O, zero side effects.
// Configs import from "@bosun/spec" and call these to declare a static Spec.

/** A secret reference map: env-var name → op:// URI (never a value). */
export type SecretRefs = Record<string, string>;

/** An HTTP health probe: polls a URL and checks the response status. */
export type HttpProbe = {
  kind: "http";
  url: string;
  expectedStatus: number;
  /** Whether to assert the TLS certificate is valid and unexpired. */
  certValid: boolean;
};

/** A shell health probe: runs a command and checks exit code 0. */
export type CmdProbe = {
  kind: "cmd";
  description: string;
  command: string;
};

export type HealthProbe = HttpProbe | CmdProbe;

/** A declared service in the stack. */
export type ServiceSpec = {
  name: string;
  image: string;
  secrets: SecretRefs;
  env: Record<string, string>;
  health: HealthProbe[];
  /** Public hostname to wire via Cloudflare tunnel. */
  route?: string;
  /** Internal upstream to reverse-proxy /api/* requests to. */
  proxyApiTo?: string;
  /** Shell command override for the container. */
  command?: string;
};

/** A PostgreSQL service (treated specially for volume + config wiring). */
export type PostgresSpec = {
  name: "postgres";
  image: string;
  volume: string;
  config?: string[];
  init?: string[];
  secrets: SecretRefs;
  env: Record<string, string>;
  health: HealthProbe[];
};

export type AnyServiceSpec = ServiceSpec | PostgresSpec;

/** Top-level static description of a stack — the output of evaluating deploy.config.ts. */
export type Spec = {
  name: string;
  services: AnyServiceSpec[];
};

// ─── Builder functions ────────────────────────────────────────────────────────

/** Declare the top-level stack. Returns a Spec (plain data). */
export function stack(name: string, opts: { services: AnyServiceSpec[] }): Spec {
  return { name, services: opts.services };
}

/** Declare a generic service. Returns a ServiceSpec (plain data). */
export function service(
  name: string,
  opts: {
    image: string;
    secrets?: SecretRefs;
    env?: Record<string, string>;
    health?: HealthProbe[];
    route?: string;
    proxyApiTo?: string;
    command?: string;
  },
): ServiceSpec {
  return {
    name,
    image: opts.image,
    secrets: opts.secrets ?? {},
    env: opts.env ?? {},
    health: opts.health ?? [],
    ...(opts.route !== undefined && { route: opts.route }),
    ...(opts.proxyApiTo !== undefined && { proxyApiTo: opts.proxyApiTo }),
    ...(opts.command !== undefined && { command: opts.command }),
  };
}

/** Declare a Postgres service with volume + optional config/init mounts. */
export function postgres(opts: {
  volume: string;
  config?: string[];
  init?: string[];
}): PostgresSpec {
  return {
    name: "postgres",
    // Pin to a stable Postgres 16 image; the config can override via a service() if needed.
    image: "postgres:16-alpine",
    volume: opts.volume,
    ...(opts.config !== undefined && { config: opts.config }),
    ...(opts.init !== undefined && { init: opts.init }),
    secrets: {},
    env: {},
    health: [],
  };
}

/**
 * Produce an image reference for a GHCR image under the 0x63616c org.
 * Defaults to the :main tag (overridable for SHA-pinned deploys).
 */
export function ghcr(name: string, tag = "main"): string {
  return `ghcr.io/0x63616c/${name}:${tag}`;
}

/**
 * Produce a SecretRefs map from a 1Password vault and item-path map.
 * Each value becomes an op:// URI — never a secret value.
 * Resolution happens later, only on the sync plane (bosun secrets sync).
 */
export function fromOp(vault: string, items: Record<string, string>): SecretRefs {
  const refs: SecretRefs = {};
  for (const [envKey, itemPath] of Object.entries(items)) {
    // op://Vault/Item/field format — the standard 1Password secret reference.
    refs[envKey] = `op://${vault}/${itemPath}`;
  }
  return refs;
}

/**
 * Declare an HTTP health probe.
 * The tool polls this URL and asserts the response status matches expectedStatus.
 */
export function httpProbe(
  url: string,
  expectedStatus: number,
  opts: { certValid?: boolean } = {},
): HttpProbe {
  return {
    kind: "http",
    url,
    expectedStatus,
    certValid: opts.certValid ?? false,
  };
}

/**
 * Declare a shell-command health probe.
 * The tool runs this command and asserts exit code 0.
 */
export function cmdProbe(description: string, command: string): CmdProbe {
  return { kind: "cmd", description, command };
}
