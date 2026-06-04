import type { Spec } from "../spec.ts";

// docker stack deploy interpolates the compose file, so a literal `$` in a
// command (e.g. cloudflared's `$(cat /run/secrets/...)`) must be doubled to
// `$$` or the deploy is rejected with "invalid interpolation format". The
// function replacement avoids `$$`'s special meaning in String.replace.
function escapeComposeInterpolation(value: string): string {
  return value.replace(/\$/g, () => "$$");
}

// Render the static Spec + resolved secret name map to a Docker Swarm stack YAML.
// The rendered YAML references hashed docker secret names — never plain values.
// Output is deterministic: same inputs always produce byte-identical output.
export function renderStackYml(spec: Spec, secretNames: Record<string, string>): string {
  const lines: string[] = ["version: '3.8'", "", "services:"];

  for (const svc of spec.services) {
    lines.push(`  ${svc.name}:`);
    lines.push(`    image: ${svc.image}`);

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
        // Mount at /run/secrets/<declared-name> so the app reads a stable path.
        lines.push(`        target: /run/secrets/${sec.name}`);
      }
    }

    // Bind/volume mounts (e.g. the docker socket for the Ofelia controller).
    if (svc.volumes && svc.volumes.length > 0) {
      lines.push("    volumes:");
      for (const vol of svc.volumes) {
        lines.push(`      - ${vol}`);
      }
    }

    // Stack label for ownership tracking.
    lines.push("    deploy:");
    lines.push("      labels:");
    lines.push(`        - bosun.stack=${spec.stackName}`);
    // Scheduled jobs drive Ofelia via deploy labels. Translate the spec's
    // standard 5-field cron to Ofelia's 6-field (seconds-leading) format by
    // prepending "0 ". Label namespace: ofelia.<jobtype>.<name>.{schedule,command}.
    if (svc.schedule) {
      const prefix = `ofelia.${svc.schedule.jobType}.${svc.name}`;
      lines.push(`        - ${prefix}.schedule=0 ${svc.schedule.cron}`);
      if (svc.command) {
        lines.push(`        - ${prefix}.command=${escapeComposeInterpolation(svc.command)}`);
      }
    }
    // Placement constraints sit under deploy.placement.
    if (svc.placement && svc.placement.length > 0) {
      lines.push("      placement:");
      lines.push("        constraints:");
      for (const c of svc.placement) {
        lines.push(`          - ${c}`);
      }
    }
    lines.push("      restart_policy:");
    // A one-shot job should not be restarted on success; long-lived services
    // restart on failure. job-exec/job-run containers are managed by Ofelia.
    lines.push(`        condition: ${svc.schedule ? "none" : "on-failure"}`);

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
