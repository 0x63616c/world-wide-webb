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
// `docker stack deploy` rolls the service iff its digest changed — without
// relying on `--resolve-image` re-resolving the mutable `:main` tag (which
// silently failed to roll the self-deploying bosun-agent; www-czg). Third-party
// and un-overridden images pass through unchanged, so only rebuilt services roll.
export function pinImage(image: string, overrides?: Record<string, string>): string {
  if (!overrides) return image;
  const m = image.match(/^ghcr\.io\/0x63616c\/([^:@]+)(?::[^@]+)?$/);
  if (!m) return image;
  const digest = overrides[m[1]];
  return digest ? `ghcr.io/0x63616c/${m[1]}@${digest}` : image;
}

// Render the static Spec + resolved secret name map to a Docker Swarm stack YAML.
// The rendered YAML references hashed docker secret names — never plain values.
// `imageOverrides` (optional) maps a ghcr image name to the digest to pin it to
// (see pinImage); omitted/empty keeps the declared `:main` tags.
// Output is deterministic: same inputs always produce byte-identical output.
export function renderStackYml(
  spec: Spec,
  secretNames: Record<string, string>,
  imageOverrides?: Record<string, string>,
): string {
  const lines: string[] = ["version: '3.8'", "", "services:"];

  // Named volumes referenced by services (bare-name sources, not bind paths).
  // Collected here and declared at the top level so docker stack deploy binds
  // them to the managed cc_<name> volume instead of auto-creating a stack-
  // prefixed empty one — which is what dropped postgres's data dir.
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

    // Secret references — use hashed docker names, not plain names.
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
        // must be the bare declared name — docker resolves it to the stable path
        // /run/secrets/<declared-name>. Passing the full path double-nests the
        // mount to /run/secrets//run/secrets/<name>, which the app can't read.
        lines.push(`        target: ${sec.name}`);
      }
    }

    // Volume mounts. A bare-name source (no leading "/" or ".") is a managed
    // named volume — prefix it cc_<name> (matching the secret convention) and
    // record it for the top-level declaration so its data persists. A path
    // source is a bind mount (e.g. the docker socket) and passes through as-is.
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push("    volumes:");
      for (const vol of svc.volumes) {
        const source = vol.split(":")[0];
        const isNamed = source.length > 0 && !source.startsWith("/") && !source.startsWith(".");
        if (isNamed) {
          namedVolumes.add(source);
          lines.push(`      - cc_${vol}`);
        } else {
          lines.push(`      - ${vol}`);
        }
      }
    }

    // Stack label for ownership tracking.
    lines.push("    deploy:");
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
    // Long-lived services restart on failure. (Cron jobs never reach here — they
    // are excluded above and run as one-shot Swarm jobs by the scheduler.)
    lines.push("        condition: on-failure");

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
  // cc_<name> via `name:` (overriding the stack-name prefix). docker reuses the
  // volume if it exists (preserving data) and creates it if not.
  if (namedVolumes.size > 0) {
    lines.push("");
    lines.push("volumes:");
    for (const v of [...namedVolumes].sort()) {
      lines.push(`  cc_${v}:`);
      lines.push(`    name: cc_${v}`);
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
