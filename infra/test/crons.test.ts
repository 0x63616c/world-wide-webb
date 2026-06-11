import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, test } from "vitest";
import { renderCronJob } from "../src/render.ts";
import type { CronJobSpec } from "../src/spec.ts";

// The k8s CronJobs that re-home bosun's scheduler (CC-j934.7): portal-data-purge
// + map-extract carried over from deploy.config.ts, plus a NEW nightly pg-backup
// to the NAS. Two things are deliberately ABSENT: docker-image-prune (kubelet
// image GC replaces it) and portal-cert-renew (cert-manager owns TLS now). These
// tests pin the declarations (pure data) before the Pulumi wiring.

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
// same way services.ts threads it into the media-worker volume (CC-j934.17).
const NAS = "192.168.0.218";

const byName = (specs: CronJobSpec[], name: string) => specs.find((s) => s.name === name);

describe("cronSpecs: the declared CronJob set", () => {
  test("declares exactly portal-data-purge, map-extract, pg-backup (no image-prune, no cert-renew)", () => {
    const names = crons
      .cronSpecs(NAS)
      .map((c) => c.name)
      .sort();
    expect(names).toEqual(["map-extract", "pg-backup", "portal-data-purge"]);
  });

  test("docker-image-prune does NOT exist (kubelet image GC replaces it)", () => {
    expect(byName(crons.cronSpecs(NAS), "docker-image-prune")).toBeUndefined();
  });

  test("portal-cert-renew does NOT exist (cert-manager owns TLS renewal)", () => {
    expect(byName(crons.cronSpecs(NAS), "portal-cert-renew")).toBeUndefined();
  });
});

describe("portal-data-purge", () => {
  const purge = () => byName(crons.cronSpecs(NAS), "portal-data-purge");

  test("runs the api image's purge entrypoint nightly at 02:00 LA", () => {
    const c = purge();
    expect(c?.image).toBe("ghcr.io/0x63616c/control-center-api:main");
    expect(c?.schedule).toBe("0 2 * * *");
    expect(c?.command).toEqual(["bun", "purge.js"]);
    expect(c?.env?.TZ).toBe("America/Los_Angeles");
  });

  test("points DATABASE at the CNPG rw Service and mounts only POSTGRES_PASSWORD", () => {
    const c = purge();
    // In k3s the api default host "postgres" does not resolve; the CNPG Service does.
    expect(c?.env?.POSTGRES_HOST).toBe("control-center-rw");
    expect(c?.secrets?.map((s) => s.name)).toEqual(["POSTGRES_PASSWORD"]);
  });

  test("renders one-shot semantics (Forbid + restartPolicy Never), not suspended", () => {
    const r = renderCronJob(purge() as CronJobSpec);
    expect(r.cronJob.spec.concurrencyPolicy).toBe("Forbid");
    expect(r.cronJob.spec.suspend).toBe(false);
    expect(r.cronJob.spec.jobTemplate.spec.template.spec.restartPolicy).toBe("Never");
  });
});

describe("map-extract", () => {
  const extract = () => byName(crons.cronSpecs(NAS), "map-extract");

  test("ships SUSPENDED (manual-trigger via kubectl create job --from=cronjob/...)", () => {
    const r = renderCronJob(extract() as CronJobSpec);
    expect(r.cronJob.spec.suspend).toBe(true);
  });

  test("runs the go-pmtiles extract into the maps PVC", () => {
    const c = extract();
    expect(c?.image).toContain("go-pmtiles");
    expect(c?.command?.[0]).toBe("extract");
    // Writes into the same local-path `maps` PVC the web service serves from.
    const vol = c?.volumes?.[0];
    expect(vol?.claim).toBe("maps");
  });
});

describe("pg-backup (NEW nightly logical backup to the NAS)", () => {
  const backup = () => byName(crons.cronSpecs(NAS), "pg-backup");

  test("runs nightly and is NOT suspended (it must actually fire)", () => {
    const r = renderCronJob(backup() as CronJobSpec);
    expect(r.cronJob.spec.suspend).toBe(false);
    // A nightly schedule (off-peak, ahead of the 02:00 purge).
    expect(backup()?.schedule).toBe("0 1 * * *");
  });

  test("uses a postgres image whose major matches the CNPG server (pg_dump version parity)", () => {
    expect(backup()?.image).toBe("ghcr.io/cloudnative-pg/postgresql:17");
  });

  test("writes a DATED control_center-YYYYMMDD.sql.gz artifact", () => {
    const cmd = (backup()?.command ?? []).join(" ");
    // The dated filename pattern (date +%Y%m%d) and gzip compression.
    expect(cmd).toContain("control_center-");
    expect(cmd).toMatch(/%Y%m%d/);
    expect(cmd).toContain("gzip");
    // pg_dump against the CNPG rw Service.
    expect(cmd).toContain("pg_dump");
    expect(cmd).toContain("control-center-rw");
  });

  test("targets the NAS over an NFS PV with the mandatory NFSv3 mount options", () => {
    const r = renderCronJob(backup() as CronJobSpec);
    expect(r.persistentVolumes).toHaveLength(1);
    const pv = r.persistentVolumes[0];
    expect(pv.spec.mountOptions).toEqual(["nfsvers=3", "nolock", "tcp"]);
    // The DS420+ exports only /volume1/Homelab; subPath lands in a backups dir.
    expect(pv.spec.nfs.server).toBe(NAS);
    expect(pv.spec.nfs.path).toBe("/volume1/Homelab");
  });

  test("threads the configurable NAS server into the NFS PV (CC-j934.17)", () => {
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
    const res = crons.deployCrons({ provider, namespace: "control-center", nasNfsServer: NAS });
    expect(res.jobs).toHaveLength(crons.cronSpecs(NAS).length);
  });
});
