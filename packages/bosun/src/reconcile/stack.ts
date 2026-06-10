import type { Spec } from "../spec.ts";

// docker stack deploy interpolates the compose file, so a literal `$` in a
// command (e.g. cloudflared's `$(cat /run/secrets/...)`) must be doubled to
// `$$` or the deploy is rejected with "invalid interpolation format". The
// function replacement avoids `$$`'s special meaning in String.replace.
function escapeComposeInterpolation(value: string): string {
  return value.replace(/\$/g, () => "$$");
}

// Pin one of OUR ghcr images (`ghcr.io/0x63616c/<name>:<tag>`) to the exact
// digest CI just built (`...@sha256:...`) when `<name>` is in the override map.
// A digest-pinned image is an immutable, unique-per-build spec string, so
// `docker stack deploy` rolls the service iff its digest changed, without
// relying on `--resolve-image` re-resolving the mutable `:main` tag (which
// silently failed to roll the self-deploying bosun-agent; www-czg). Third-party
// and un-overridden images pass through unchanged, so only rebuilt services roll.
function pinImage(image: string, overrides?: Record<string, string>): string {
  if (!overrides) return image;
  const m = image.match(/^ghcr\.io\/0x63616c\/([^:@]+)(?::[^@]+)?$/);
  if (!m) return image;
  const digest = overrides[m[1]];
  return digest ? `ghcr.io/0x63616c/${m[1]}@${digest}` : image;
}

// Container-memory budget for the deploy VM, in MiB (www-ke9a). The OrbStack
// Linux VM is 5GB; reserve ~1GB for the guest kernel + system (page tables,
// dirty-writeback, docker engine), leaving ~4GB for container memory limits.
// renderStackYml SUMS every service's memory limit and REFUSES to render if the
// total exceeds this, so a future overcommit fails the deploy loudly instead of
// silently over-subscribing the VM and reintroducing the RCU-stall/OOM outage
// class (www-nqqj). Bumped from 4GB→5GB in www-jagy; keep this in sync with the VM.
/** @public, deploy-spec budget constant; surfaced for tests + future plan checks (www-ke9a). */
export const VM_MEMORY_BUDGET_MIB = 4096;

// Parse a compose memory string ("96M", "768M", "1G", optionally "Mi"/"Gi") to
// MiB. Compose uses powers of two for the suffixes, so 1G == 1024M. Throws on an
// unrecognised unit so a typo can never silently under-count the budget sum.
function parseMemoryToMiB(mem: string): number {
  const m = mem.trim().match(/^(\d+(?:\.\d+)?)\s*([KMG])i?[Bb]?$/);
  if (!m) {
    throw new Error(`Unrecognised memory string '${mem}' (expected e.g. "768M" or "1G")`);
  }
  const value = Number.parseFloat(m[1]);
  const factor = { K: 1 / 1024, M: 1, G: 1024 }[m[2] as "K" | "M" | "G"];
  return value * factor;
}

// Enforce the overcommit invariant: the summed hard memory limits of all
// long-lived services must stay under the VM budget. THROWS (refusing the whole
// stack) when exceeded so an overcommit can never reach the swarm.
function assertMemoryBudget(spec: Spec): void {
  let totalMiB = 0;
  for (const svc of spec.services) {
    if (svc.schedule) continue; // cron jobs aren't long-lived stack services.
    const mem = svc.resources?.memory;
    if (mem) totalMiB += parseMemoryToMiB(mem);
  }
  if (totalMiB > VM_MEMORY_BUDGET_MIB) {
    throw new Error(
      `Memory overcommit: service memory limits sum to ${totalMiB} MiB, ` +
        `exceeding the VM budget of ${VM_MEMORY_BUDGET_MIB} MiB by ` +
        `${totalMiB - VM_MEMORY_BUDGET_MIB} MiB. Lower a service's resources.memory ` +
        "or raise VM_MEMORY_BUDGET_MIB only after bumping the VM (www-jagy).",
    );
  }
}

// Render the static Spec + resolved secret name map to a Docker Swarm stack YAML.
// The rendered YAML references hashed docker secret names, never plain values.
// `imageOverrides` (optional) maps a ghcr image name to the digest to pin it to
// (see pinImage); omitted/empty keeps the declared `:main` tags.
// Output is deterministic: same inputs always produce byte-identical output.
export function renderStackYml(
  spec: Spec,
  secretNames: Record<string, string>,
  imageOverrides?: Record<string, string>,
): string {
  // Refuse the whole stack if the summed memory limits overcommit the VM (www-ke9a).
  assertMemoryBudget(spec);

  const lines: string[] = ["version: '3.8'", "", "services:"];

  // Named volumes referenced by services (bare-name sources, not bind paths).
  // Collected here and declared at the top level so docker stack deploy binds
  // them to the managed <stack>_<name> volume instead of auto-creating a
  // separate empty one, which is what dropped postgres's data dir.
  const namedVolumes = new Set<string>();

  for (const svc of spec.services) {
    // Cron jobs are NOT long-lived stack services: the bosun scheduler runs them
    // on their cron as one-shot Swarm jobs, so they are excluded from the
    // deployed stack entirely (no service block, no labels).
    if (svc.schedule) continue;

    lines.push(`  ${svc.name}:`);
    lines.push(`    image: ${pinImage(svc.image, imageOverrides)}`);

    // Env vars (non-secret, static values only).
    if (Object.keys(svc.env).length > 0) {
      lines.push("    environment:");
      // Sort keys for determinism.
      for (const key of Object.keys(svc.env).sort()) {
        lines.push(`      - ${key}=${svc.env[key]}`);
      }
    }

    // LAN-reachable published port for a LAN-only service (www-q002.12/.14). Emit a
    // long-form INGRESS published port. The deploy target is OrbStack single-node
    // Swarm: OrbStack forwards standard/ingress published ports to the Mac HOST and
    // to the LAN (its default "expose ports to LAN"), so the port lands on the
    // Mini's LAN IP. `mode: host` does NOT work here, it binds inside the OrbStack
    // Linux VM's container netns and bypasses that forwarding, so it never surfaces
    // on the Mac/LAN (the www-q002.14 prod failure: nothing listened on the LAN :443
    // until this switched off host mode). This is orthogonal to `route`: a
    // publishPort service has no route, so the Cloudflare ingress/DNS reconcile
    // (keyed off svc.route) never touches it.
    if (svc.publishPort) {
      lines.push("    ports:");
      lines.push(`      - target: ${svc.publishPort.container}`);
      lines.push(`        published: ${svc.publishPort.host}`);
      lines.push("        mode: ingress");
    }

    // Secret references, use hashed docker names, not plain names.
    if (svc.secrets.length > 0) {
      lines.push("    secrets:");
      for (const sec of svc.secrets) {
        const dockerName = secretNames[sec.name];
        if (!dockerName) {
          throw new Error(
            `Secret '${sec.name}' for service '${svc.name}' not found in secretNames map`,
          );
        }
        lines.push(`      - source: ${dockerName}`);
        // `target` is the filename docker mounts *under* /run/secrets/, so it
        // must be the bare declared name, docker resolves it to the stable path
        // /run/secrets/<declared-name>. Passing the full path double-nests the
        // mount to /run/secrets//run/secrets/<name>, which the app can't read.
        lines.push(`        target: ${sec.name}`);
      }
    }

    // Volume mounts. A bare-name source (no leading "/" or ".") is a managed
    // named volume, prefix it <stack>_<name> (matching the secret convention)
    // and record it for the top-level declaration so its data persists. A path
    // source is a bind mount (e.g. the docker socket) and passes through as-is.
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push("    volumes:");
      for (const vol of svc.volumes) {
        const source = vol.split(":")[0];
        const isNamed = source.length > 0 && !source.startsWith("/") && !source.startsWith(".");
        if (isNamed) {
          namedVolumes.add(source);
          lines.push(`      - ${spec.stackName}_${vol}`);
        } else {
          lines.push(`      - ${vol}`);
        }
      }
    }

    // Container healthcheck, swarm tracks State.Health.Status and gates rolling
    // updates on it. CMD-SHELL runs the test via /bin/sh -c. Defaults match the
    // common case (30s cadence, 5s timeout, 3 retries, 20s grace on boot).
    if (svc.healthcheck) {
      const hc = svc.healthcheck;
      lines.push("    healthcheck:");
      lines.push(`      test: ["CMD-SHELL", "${escapeComposeInterpolation(hc.test)}"]`);
      lines.push(`      interval: ${hc.interval ?? "30s"}`);
      lines.push(`      timeout: ${hc.timeout ?? "5s"}`);
      lines.push(`      retries: ${hc.retries ?? 3}`);
      lines.push(`      start_period: ${hc.startPeriod ?? "20s"}`);
    }

    // Stack label for ownership tracking.
    lines.push("    deploy:");
    // Explicit replica count when set (e.g. 0 to park a service at zero). Swarm
    // defaults to 1 when omitted, so only emit when the spec asks for it.
    if (svc.replicas !== undefined) {
      lines.push(`      replicas: ${svc.replicas}`);
    }
    lines.push("      labels:");
    lines.push(`        - bosun.stack=${spec.stackName}`);
    // Placement constraints sit under deploy.placement.
    if (svc.placement && svc.placement.length > 0) {
      lines.push("      placement:");
      lines.push("        constraints:");
      for (const c of svc.placement) {
        lines.push(`          - ${c}`);
      }
    }
    lines.push("      restart_policy:");
    // Long-lived services restart on failure. (Cron jobs never reach here, they
    // are excluded above and run as one-shot Swarm jobs by the scheduler.)
    lines.push("        condition: on-failure");

    // Resource caps (www-ke9a). Emit limits.memory ONLY (a hard cap that, under
    // cgroup v2, OOM-kills just this container instead of the VM), NEVER
    // limits.cpus (CPU is compressible; a hard quota only wastes idle cores).
    // Reservations (cpus/memory) are scheduling priority for the critical path
    // and are emitted only for the sub-fields the spec sets.
    if (svc.resources) {
      const r = svc.resources;
      lines.push("      resources:");
      if (r.memory) {
        lines.push("        limits:");
        lines.push(`          memory: ${r.memory}`);
      }
      if (r.reserveCpus || r.reserveMemory) {
        lines.push("        reservations:");
        if (r.reserveCpus) lines.push(`          cpus: "${r.reserveCpus}"`);
        if (r.reserveMemory) lines.push(`          memory: ${r.reserveMemory}`);
      }
    }

    if (svc.command) {
      lines.push(`    command: ${escapeComposeInterpolation(svc.command)}`);
    }
  }

  // Declare every hashed secret at the top-level secrets block.
  const allDockerSecretNames = [
    ...new Set(
      spec.services.flatMap((svc) =>
        svc.secrets.map((sec) => {
          const n = secretNames[sec.name];
          if (!n) throw new Error(`No docker name for secret '${sec.name}'`);
          return n;
        }),
      ),
    ),
  ].sort();

  if (allDockerSecretNames.length > 0) {
    lines.push("");
    lines.push("secrets:");
    for (const name of allDockerSecretNames) {
      lines.push(`  ${name}:`);
      lines.push("    external: true");
    }
  }

  // Declare every named volume at top level, pinning its real docker name to
  // <stack>_<name> via `name:` so it is explicit and stable. docker reuses the
  // volume if it exists (preserving data) and creates it if not.
  if (namedVolumes.size > 0) {
    lines.push("");
    lines.push("volumes:");
    for (const v of [...namedVolumes].sort()) {
      lines.push(`  ${spec.stackName}_${v}:`);
      lines.push(`    name: ${spec.stackName}_${v}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

// Deploy a rendered stack YAML to the swarm via docker stack deploy.
// Returns the stdout of the deploy command.
export async function deployStack(stackName: string, stackYml: string): Promise<string> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(exec);

  const tmpFile = `/tmp/bosun-${stackName}-stack.yml`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(tmpFile, stackYml, "utf-8");

  const { stdout } = await run(
    `docker stack deploy --prune --with-registry-auth -c ${tmpFile} ${stackName}`,
  );
  return stdout;
}
