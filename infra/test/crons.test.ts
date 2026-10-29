import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import {
  defineDatabaseBackup,
  defineProduct,
  defineProductDatabase,
  homelabTarget,
} from "@www/platform";
import { beforeAll, describe, expect, test } from "vitest";
import type { CronJobSpec } from "../src/component.ts";
import { renderCronJob } from "../src/component.ts";

// The k8s CronJobs for the cluster scheduler (www-j934.7): a nightly pg-backup
// to the NAS. Every retention purge runs as an App-owned Worker cycle; the
// legacy hand-wired data-purge CronJob is retired. Two things are deliberately
// ABSENT: docker-image-prune (kubelet image GC replaces it) and
// portal-cert-renew (cert-manager owns TLS now). These tests pin the
// declarations (pure data) before the Pulumi wiring.

pulumi.runtime.setMocks({
  newResource(args: pulumi.runtime.MockResourceArgs) {
    return { id: `${args.name}-id`, state: args.inputs };
  },
  call() {
    return {};
  },
});

let crons: typeof import("../src/crons.ts");
beforeAll(async () => {
  crons = await import("../src/crons.ts");
});

// The NAS server (default LAN IP) the pg-backup NFS PV points at, threaded in the
// same way services.ts threads it into the worker media volume (www-j934.17).
const NAS = "192.168.0.218";
const testNamespaces = {
  "control-center": "control-center",
  cloudflare: "cloudflare",
} as const;

function get<T>(r: pulumi.Resource, prop: string): Promise<T> {
  const out = (r as unknown as Record<string, pulumi.Output<T>>)[prop];
  return new Promise((resolve) => {
    out.apply((value) => {
      resolve(value);
      return value;
    });
  });
}

type CronSpec = ReturnType<typeof crons.cronSpecs>[number];
const byName = (specs: CronSpec[], name: string) => specs.find((s) => s.name === name);

describe("cronSpecs: the declared CronJob set", () => {
  // Every retention purge is deliberately ABSENT: they are App-owned Worker
  // cycles (issue #260); only infra-level crons render CronJobs.
  test("declares only the product backup (no purges, no image-prune, no cert-renew)", () => {
    const names = crons
      .cronSpecs(NAS)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["pg-backup"]);
  });

  test("docker-image-prune does NOT exist (kubelet image GC replaces it)", () => {
    expect(byName(crons.cronSpecs(NAS), "docker-image-prune")).toBeUndefined();
  });

  test("portal-cert-renew does NOT exist (cert-manager owns TLS renewal)", () => {
    expect(byName(crons.cronSpecs(NAS), "portal-cert-renew")).toBeUndefined();
  });
});

describe("pg-backup (NEW nightly logical backup to the NAS)", () => {
  const backup = () => byName(crons.cronSpecs(NAS), "pg-backup");

  test("derives a product Postgres backup CronJob from the platform backup primitive", () => {
    const product = defineProduct("control-center");
    const database = defineProductDatabase(product, homelabTarget, { size: "5Gi" });
    const platformBackup = defineDatabaseBackup(database, homelabTarget);
    const spec = crons.postgresBackupCronSpec(platformBackup, NAS);
    const rendered = renderCronJob(spec);

    expect(spec.name).toBe("control-center-pg-backup");
    expect(spec.schedule).toBe("0 1 * * *");
    expect(spec.image).toBe("ghcr.io/cloudnative-pg/postgresql:18");
    expect(spec.command?.join("\n")).toContain("pg_dump -h postgres-rw");
    expect(spec.command?.join("\n")).toContain("-d control_center");
    expect(spec.volumes?.[0]).toMatchObject({
      mountPath: "/backup",
      nfs: { server: NAS, path: "/volume1/Homelab" },
      subPath: "backups/world-wide-webb/control-center/postgres",
    });
    expect(rendered.cronJob.spec.concurrencyPolicy).toBe("Forbid");
    expect(rendered.cronJob.spec.jobTemplate.spec.template.spec.restartPolicy).toBe("Never");
  });

  test("runs nightly and is NOT suspended (it must actually fire)", () => {
    const r = renderCronJob(backup() as CronJobSpec);
    expect(r.cronJob.spec.suspend).toBe(false);
    // A nightly schedule (off-peak, ahead of the 02:00 purge).
    expect(backup()?.schedule).toBe("0 1 * * *");
  });

  test("uses a postgres image whose major matches the CNPG server (pg_dump version parity)", () => {
    // Must match cnpg.ts's server major (PG 18); a mismatch makes pg_dump abort.
    expect(backup()?.image).toBe("ghcr.io/cloudnative-pg/postgresql:18");
  });

  test("fails the job on a pg_dump error (pipefail, not a silent broken artifact)", () => {
    const cmd = (backup()?.command ?? []).join("\n");
    // pipefail is what makes a failed pg_dump (piped into gzip) fail the job.
    expect(cmd).toContain("pipefail");
  });

  test("writes a DATED control_center-YYYYMMDD.sql.gz artifact", () => {
    const cmd = (backup()?.command ?? []).join(" ");
    // The dated filename pattern (date +%Y%m%d) and gzip compression.
    expect(cmd).toContain("control_center-");
    expect(cmd).toMatch(/%Y%m%d/);
    expect(cmd).toContain("gzip");
    // pg_dump against the CNPG rw Service.
    expect(cmd).toContain("pg_dump");
    expect(cmd).toContain("control-center-postgres-rw");
  });

  test("targets the NAS over an NFS PV with the mandatory NFSv3 mount options", () => {
    const r = renderCronJob(backup() as CronJobSpec);
    expect(r.persistentVolumes).toHaveLength(1);
    const pv = r.persistentVolumes[0];
    // soft + short timeo/retrans (#793): a dead NAS returns EIO, not a hang.
    expect(pv.spec.mountOptions).toEqual([
      "nfsvers=4.0",
      "nolock",
      "soft",
      "timeo=50",
      "retrans=2",
    ]);
    // The DS420+ exports only /volume1/Homelab; subPath lands in a backups dir.
    expect(pv.spec.nfs.server).toBe(NAS);
    expect(pv.spec.nfs.path).toBe("/volume1/Homelab");
  });

  test("caps the Job wall-clock so an unmountable target fails fast (#790, #793)", () => {
    const r = renderCronJob(backup() as CronJobSpec);
    expect(r.cronJob.spec.jobTemplate.spec.activeDeadlineSeconds).toBe(
      crons.PG_BACKUP_ACTIVE_DEADLINE_SECONDS,
    );
  });

  test("nasEnabled=false backs up to the local fallback PVC with pruning, NFS PV kept but unmounted (#793)", () => {
    const spec = byName(crons.cronSpecs(NAS, false), "pg-backup") as CronJobSpec;
    const r = renderCronJob(spec);
    const on = renderCronJob(backup() as CronJobSpec);
    // The NFS PV/PVC keep their names (no delete/replace of a PVC a wedged pod pins).
    expect(r.persistentVolumes.map((pv) => pv.metadata.name)).toEqual(
      on.persistentVolumes.map((pv) => pv.metadata.name),
    );
    expect(spec.volumes?.[0]).toMatchObject({
      claim: crons.PG_BACKUP_FALLBACK_CLAIM,
      detached: true,
    });
    const podVolumes = r.cronJob.spec.jobTemplate.spec.template.spec.volumes;
    expect(podVolumes).toContainEqual(
      expect.objectContaining({
        persistentVolumeClaim: { claimName: crons.PG_BACKUP_FALLBACK_CLAIM },
      }),
    );
    for (const pv of r.persistentVolumes) {
      expect(podVolumes).not.toContainEqual(
        expect.objectContaining({ persistentVolumeClaim: { claimName: pv.metadata.name } }),
      );
    }
    const cmd = spec.command?.join(" ") ?? "";
    expect(cmd).toContain("pg_dump");
    expect(cmd).toMatch(/find \S+ -maxdepth 1 -name '\*\.sql\.gz' -mtime \+\d+ -delete/);
  });

  test("nasEnabled=true keeps the NAS target and never prunes it", () => {
    const spec = byName(crons.cronSpecs(NAS, true), "pg-backup") as CronJobSpec;
    expect(spec.command?.join(" ")).not.toContain("-delete");
    expect(spec.volumes?.[0]?.nfs?.server).toBe(NAS);
  });

  test("threads the configurable NAS server into the NFS PV (www-j934.17)", () => {
    const r = renderCronJob(byName(crons.cronSpecs("100.78.116.99"), "pg-backup") as CronJobSpec);
    expect(r.persistentVolumes[0].spec.nfs.server).toBe("100.78.116.99");
  });

  test("reads the DB password from the CNPG-managed basic-auth Secret, not a duplicate", () => {
    const c = backup();
    // The CNPG superuser/owner basic-auth Secret (cc-postgres-auth) mounted as files;
    // pg_dump reads the password from it via PGPASSFILE/the mounted path.
    expect(c?.extraSecretMounts?.some((m) => m.secretName === "cc-postgres-auth")).toBe(true);
  });
});

describe("deployCrons (Pulumi wiring)", () => {
  test("instantiates a ScheduledJob per declared cron", async () => {
    const provider = new (await import("@pulumi/kubernetes")).Provider("test", { context: "x" });
    const res = crons.deployCrons({ provider, namespaces: testNamespaces, nasNfsServer: NAS });
    expect(res.jobs).toHaveLength(crons.cronSpecs(NAS).length);
  });

  test("creates one fallback PVC per backup namespace only when the NAS is off (#793)", async () => {
    const provider = new (await import("@pulumi/kubernetes")).Provider("test-fallback", {
      context: "x",
    });
    const on = crons.deployCrons({ provider, namespaces: testNamespaces, nasNfsServer: NAS });
    expect(on.fallbackClaims).toHaveLength(0);
    const off = crons.deployCrons({
      provider,
      namespaces: testNamespaces,
      nasNfsServer: NAS,
      nasEnabled: false,
    });
    expect(off.fallbackClaims).toHaveLength(1);
  });

  test("instantiates CronJobs in their owning namespaces", async () => {
    const provider = new (await import("@pulumi/kubernetes")).Provider("test-namespaces", {
      context: "x",
    });
    const res = crons.deployCrons({ provider, namespaces: testNamespaces, nasNfsServer: NAS });
    const metadata = await Promise.all(
      res.jobs.map((job) => get<{ name: string; namespace: string }>(job.cronJob, "metadata")),
    );

    expect(metadata.find((m) => m.name === "pg-backup")?.namespace).toBe("control-center");
  });
});

// Task 4 (Talos migration, §7): two NEW pure builders for home-assistant's
// backup crons. These are plain CronJobSpec (not OwnedCronJobSpec) , unlike
// every cron above, they are NOT part of cronSpecs()/deployCrons()'s closed
// InfraNamespaceName-keyed namespace map (home-assistant's namespace is
// created directly in homeassistant.ts, L1). homeassistant.ts is the only
// caller, itself only invoked from program.ts behind `substrate === "talos"`.
describe("homeAssistantPgBackupCronSpec (Task 4)", () => {
  const args = {
    nasNfsServer: NAS,
    serviceHost: "home-assistant-postgres-rw",
    databaseName: "home_assistant",
    owner: "postgres",
    authSecretName: "home-assistant-postgres-auth",
  };

  test("pg_dumps the home_assistant database, mirroring control-center's pattern", () => {
    const spec = crons.homeAssistantPgBackupCronSpec(args);
    expect(spec.name).toBe("home-assistant-pg-backup");
    const cmd = spec.command?.join("\n") ?? "";
    expect(cmd).toContain("set -eo pipefail");
    expect(cmd).toContain(
      `pg_dump -h ${args.serviceHost} -U ${args.owner} -d ${args.databaseName}`,
    );
  });

  test("mounts the CNPG basic-auth secret and a NAS destination under home-assistant/postgres", () => {
    const spec = crons.homeAssistantPgBackupCronSpec(args);
    expect(spec.extraSecretMounts?.[0]?.secretName).toBe(args.authSecretName);
    const nfsVol = spec.volumes?.find((v) => v.nfs);
    expect(nfsVol?.subPath).toBe("backups/world-wide-webb/home-assistant/postgres");
  });
});

describe("backup storage identity and verification (#790)", () => {
  const ha = (nasEnabled: boolean) =>
    crons.homeAssistantPgBackupCronSpec({
      nasNfsServer: NAS,
      serviceHost: "home-assistant-postgres-rw",
      databaseName: "home_assistant",
      owner: "postgres",
      authSecretName: "home-assistant-postgres-auth",
      nasEnabled,
    });

  for (const nasEnabled of [false, true]) {
    test(`both backups render writable non-root storage and bounded retries (NAS=${nasEnabled})`, () => {
      for (const spec of [crons.cronSpecs(NAS, nasEnabled)[0], ha(nasEnabled)]) {
        const job = renderCronJob(spec).cronJob.spec;
        expect(job.concurrencyPolicy).toBe("Forbid");
        expect(job.jobTemplate.spec).toMatchObject({
          activeDeadlineSeconds: 1800,
          backoffLimit: 1,
          template: {
            spec: {
              restartPolicy: "Never",
              securityContext: {
                runAsUser: 26,
                runAsGroup: 26,
                fsGroup: 26,
                runAsNonRoot: true,
                fsGroupChangePolicy: "OnRootMismatch",
              },
            },
          },
        });
      }
    });
  }

  for (const target of ["control-center", "home-assistant"]) {
    for (const outcome of [
      "valid",
      "complete-empty",
      "empty",
      "small",
      "truncated",
      "trailing-content",
      "dump-failure",
      "corrupt-gzip",
    ]) {
      test(`${target}: ${outcome} only publishes a verified dump`, () => {
        const dir = mkdtempSync(join(tmpdir(), "pg-backup-"));
        try {
          const spec = target === "control-center" ? crons.cronSpecs(NAS, false)[0] : ha(false);
          const out = join(dir, "backup.sql.gz");
          writeFileSync(out, "previous verified backup");
          const dump = join(dir, "pg_dump");
          const trailer = "-- PostgreSQL database dump complete";
          const body =
            outcome === "empty"
              ? "exit 0"
              : outcome === "small"
                ? `printf '%s\n' '${trailer}'`
                : [
                    `printf '%${outcome === "complete-empty" ? 680 : 1048576}s\n' x`,
                    outcome === "truncated" ? "" : `printf '%s\n\n' '${trailer}'`,
                    outcome === "trailing-content" ? "echo unexpected" : "",
                    `exit ${outcome === "dump-failure" ? 1 : 0}`,
                  ].join("\n");
          const passes =
            outcome === "valid" || (target === "home-assistant" && outcome === "complete-empty");
          writeFileSync(dump, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
          if (outcome === "corrupt-gzip") {
            writeFileSync(
              join(dir, "gzip"),
              '#!/bin/bash\nif [ "$1" = "-c" ]; then cat >/dev/null; echo corrupt; else exec /usr/bin/gzip "$@"; fi\n',
              { mode: 0o755 },
            );
          }
          const script = (spec.command?.[2] ?? "")
            .replace(/^export PGPASSWORD=.*$/m, "")
            .replace(/^out=.*$/m, `out="${out}"`)
            .replace(/^find .*$/m, "");
          const result = spawnSync("bash", ["-c", script], {
            env: { PATH: `${dir}:/usr/bin:/bin` },
            encoding: "utf8",
          });
          expect(result.status, result.stderr).toBe(passes ? 0 : 1);
          expect(readFileSync(out).toString() === "previous verified backup").toBe(!passes);
          if (outcome === "complete-empty" && target === "control-center") {
            expect(result.stderr).toContain("SQL dump smaller than 1024 bytes");
          }
          if (outcome === "truncated" || outcome === "trailing-content") {
            expect(result.stderr).toContain("SQL dump missing final completion trailer");
          }
          expect(spawnSync("test", ["-e", `${out}.partial`]).status).toBe(1);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});
