// metrics-server: the Metrics API (`kubectl top nodes` / `top pods`).
//
// WHY (2026-07-24): during the HA outage the mini was at 60MB free with 640MB
// swapped, and we could not answer the most basic question , which workload was
// using the memory , because `kubectl top` returned "error: Metrics API not
// available". OrbStack's bundled k3s does NOT install metrics-server, so the
// cluster had no CPU/memory visibility at all, and the OrbStack VM was sized by
// guesswork against a spec that had silently drifted 1GB. This closes that.
//
// NOTE this is live-only, not history: metrics-server keeps a short in-memory
// window and stores nothing. It answers "what is using memory right now", which
// is what was missing. Trend data would need a real TSDB and is a separate call.

import * as k8s from "@pulumi/kubernetes";

export interface MetricsServerArgs {
  provider: k8s.Provider;
  // Upstream release tag, pinned (matches the cert-manager / CNPG convention of
  // never tracking "latest" for cluster-level components).
  version: string;
}

export interface MetricsServerResources {
  install: k8s.yaml.ConfigFile;
}

export function installMetricsServer(args: MetricsServerArgs): MetricsServerResources {
  const { provider, version } = args;

  const install = new k8s.yaml.ConfigFile(
    "metrics-server",
    {
      file: `https://github.com/kubernetes-sigs/metrics-server/releases/download/${version}/components.yaml`,
      transformations: [
        (obj: { kind?: string; metadata?: { name?: string }; spec?: unknown }) => {
          if (obj.kind === "Deployment" && obj.metadata?.name === "metrics-server") {
            const spec = obj.spec as {
              template: { spec: { containers: { args?: string[] }[] } };
            };
            const c = spec.template.spec.containers[0];
            // --kubelet-insecure-tls is REQUIRED here, not laziness. metrics-server
            // verifies the kubelet's serving cert against the cluster CA, but k3s
            // issues kubelets self-signed serving certs by default, so without this
            // every scrape fails x509 and the Metrics API stays unavailable , the
            // exact symptom this component exists to fix. The connection is still
            // TLS and stays inside the single-node VM.
            c.args = [...(c.args ?? []), "--kubelet-insecure-tls"];
          }
        },
      ],
    },
    { provider },
  );

  return { install };
}
