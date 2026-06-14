// CloudNativePG: operator + a single-instance Cluster for control-center
// (www-j934.5). The Cluster runs on a local-path PVC on the mini's SSD (NOT NFS:
// corruption footgun + the DS420+ is 2GB RAM, RECON decision 5). It replaces the
// Swarm postgres() service + the named pgdata volume.
//
// Credential bridge (the key correctness point): the app connects as
// postgres@<svc>:5432/control_center with the password from
// op://Homelab/Control Center Postgres/password. CNPG must use THAT password,
// not mint a random one, so the migrated data + the app's POSTGRES_PASSWORD line
// up. ESO syncs the password into a kubernetes.io/basic-auth Secret (username
// "postgres"), which the Cluster references via bootstrap.initdb.secret +
// superuserSecret. (ESO must create that Secret before initdb runs; the operator
// retries until it appears.)

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

// The app's prod identity (products/control-center/api/src/env.ts defaults: user postgres, db
// control_center). CNPG provisions exactly these so DATABASE_URL still resolves.
const DB_NAME = "control_center";
const DB_OWNER = "postgres";
// The basic-auth Secret ESO produces (username + password) that CNPG consumes.
const PG_AUTH_SECRET = "cc-postgres-auth";
// www-ke9a cap: 768M limit, 384M request, 0.5 cpu reservation (DESIGN table).
const PG_MEMORY_LIMIT = "768Mi";
const PG_MEMORY_REQUEST = "384Mi";
const PG_CPU_REQUEST = "500m";

export interface CnpgArgs {
  provider: k8s.Provider;
  namespace: pulumi.Input<string>;
  // CNPG operator install manifest version (www-j934.4 preflight pin: 1.29.1).
  operatorVersion: string;
}

export interface CnpgResources {
  operator: k8s.yaml.ConfigFile;
  authSecret: k8s.apiextensions.CustomResource;
  cluster: k8s.apiextensions.CustomResource;
}

/**
 * @public - installs the CNPG operator and the single-instance control-center
 * Cluster with the bridged credential. Consumed by the cluster program; the app
 * Deployments (www-j934.6) point DATABASE host at the `control-center-rw` Service
 * CNPG creates. No internal consumer in this ticket yet.
 */
export function installCnpg(args: CnpgArgs): CnpgResources {
  const { provider, namespace, operatorVersion } = args;
  const opts = { provider };

  // CNPG operator (CRDs + controller) from the upstream release manifest.
  const operator = new k8s.yaml.ConfigFile(
    "cnpg-operator",
    {
      file: `https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-${operatorVersion}.yaml`,
    },
    opts,
  );

  // The basic-auth Secret CNPG uses for the superuser/owner. ESO writes it from
  // op://Homelab/Control Center Postgres/password with a fixed username so it's
  // a valid kubernetes.io/basic-auth Secret. (A dedicated ExternalSecret, not the
  // cc-secrets-* ones, because CNPG needs username+password in one basic-auth
  // Secret, distinct from the file-rail POSTGRES_PASSWORD mount.)
  const authSecret = new k8s.apiextensions.CustomResource(
    "es-postgres-auth",
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name: "es-postgres-auth", namespace },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: { kind: "ClusterSecretStore", name: "onepassword" },
        target: {
          name: PG_AUTH_SECRET,
          // Build a basic-auth Secret: a fixed username + the synced password.
          template: {
            type: "kubernetes.io/basic-auth",
            data: { username: DB_OWNER, password: "{{ .password }}" },
          },
        },
        data: [{ secretKey: "password", remoteRef: { key: "Control Center Postgres/password" } }],
      },
    },
    opts,
  );

  // The single-instance Cluster. local-path storage on the SSD; the bridged
  // password via superuserSecret + initdb.secret so CNPG adopts it.
  const cluster = new k8s.apiextensions.CustomResource(
    "control-center",
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: { name: "control-center", namespace },
      spec: {
        instances: 1,
        // Adopt the bridged password rather than minting one.
        enableSuperuserAccess: true,
        superuserSecret: { name: PG_AUTH_SECRET },
        bootstrap: {
          initdb: {
            database: DB_NAME,
            owner: DB_OWNER,
            secret: { name: PG_AUTH_SECRET },
          },
        },
        storage: { storageClass: "local-path", size: "5Gi" },
        resources: {
          requests: { memory: PG_MEMORY_REQUEST, cpu: PG_CPU_REQUEST },
          limits: { memory: PG_MEMORY_LIMIT },
        },
      },
    },
    { ...opts, dependsOn: [operator, authSecret] },
  );

  return { operator, authSecret, cluster };
}
