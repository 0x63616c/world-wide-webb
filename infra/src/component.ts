// The Pulumi ComponentResource that turns a WorkloadSpec into real kubernetes
// objects. It is deliberately THIN: all the mapping lives in the pure render
// layer (render.ts, unit-tested), and this wrapper just feeds the rendered args
// to @pulumi/kubernetes against a provided cluster. The k8s Provider is an INPUT
// (not a host path hardcoded into the component), so the same vocabulary targets
// OrbStack today and a Hetzner cluster later by swapping the provider (RECON
// decision 13 / DESIGN.md §1).

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { renderCronJob, renderWorkload } from "./render.ts";
import type { CronJobSpec, WorkloadSpec } from "./spec.ts";

export interface WorkloadArgs {
  // The declarative workload (the one typed place a service is described).
  spec: WorkloadSpec;
  // The target cluster. Passing the provider in (rather than reading an ambient
  // kubeconfig) is what makes the component cluster-agnostic and reusable.
  provider: k8s.Provider;
  // Namespace the workload's objects land in.
  namespace: pulumi.Input<string>;
}

/**
 * @public - the deploy-stack vocabulary surface (consumed by index.ts / the
 * per-environment stack programs in www-j934.6); no internal consumer in this
 * foundation ticket yet.
 */
export class Workload extends pulumi.ComponentResource {
  readonly deployment: k8s.apps.v1.Deployment;
  readonly services: k8s.core.v1.Service[];
  readonly persistentVolumes: k8s.core.v1.PersistentVolume[];

  constructor(args: WorkloadArgs, opts?: pulumi.ComponentResourceOptions) {
    super("control-center:infra:Workload", args.spec.name, {}, opts);

    const rendered = renderWorkload(args.spec);
    const childOpts: pulumi.ComponentResourceOptions = { parent: this, provider: args.provider };

    this.persistentVolumes = rendered.persistentVolumes.map(
      (pv) => new k8s.core.v1.PersistentVolume(pv.metadata.name, pv as never, childOpts),
    );

    this.deployment = new k8s.apps.v1.Deployment(
      args.spec.name,
      {
        metadata: { namespace: args.namespace, ...rendered.deployment.metadata },
        spec: rendered.deployment.spec as never,
      },
      childOpts,
    );

    this.services = rendered.services.map(
      (svc) =>
        new k8s.core.v1.Service(
          svc.metadata.name,
          { metadata: { namespace: args.namespace, ...svc.metadata }, spec: svc.spec as never },
          childOpts,
        ),
    );

    this.registerOutputs({
      deployment: this.deployment.id,
      services: this.services.map((s) => s.id),
    });
  }
}

export interface ScheduledJobArgs {
  // The declarative cron job (the one typed place a scheduled job is described).
  spec: CronJobSpec;
  // The target cluster (an input, see Workload).
  provider: k8s.Provider;
  // Namespace the CronJob's objects land in.
  namespace: pulumi.Input<string>;
}

/**
 * @public - the deploy-stack vocabulary surface (consumed by the per-environment
 * stack programs in www-j934.7 for portal-data-purge / map-extract / pg-backup);
 * no internal consumer in this foundation ticket yet.
 */
export class ScheduledJob extends pulumi.ComponentResource {
  readonly cronJob: k8s.batch.v1.CronJob;
  readonly persistentVolumes: k8s.core.v1.PersistentVolume[];

  constructor(args: ScheduledJobArgs, opts?: pulumi.ComponentResourceOptions) {
    super("control-center:infra:ScheduledJob", args.spec.name, {}, opts);

    const rendered = renderCronJob(args.spec);
    const childOpts: pulumi.ComponentResourceOptions = { parent: this, provider: args.provider };

    this.persistentVolumes = rendered.persistentVolumes.map(
      (pv) => new k8s.core.v1.PersistentVolume(pv.metadata.name, pv as never, childOpts),
    );

    this.cronJob = new k8s.batch.v1.CronJob(
      args.spec.name,
      {
        metadata: { namespace: args.namespace, ...rendered.cronJob.metadata },
        spec: rendered.cronJob.spec as never,
      },
      childOpts,
    );

    this.registerOutputs({ cronJob: this.cronJob.id });
  }
}
