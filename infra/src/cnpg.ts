// CloudNativePG: operator + product-owned single-instance Clusters. Clusters run
// on local-path PVCs on the mini's SSD (NOT NFS: corruption footgun + the DS420+
// is 2GB RAM, RECON decision 5).
//
// Credential bridge (the key correctness point): the app connects as
// postgres@<svc>:5432/<db> with the password declared by the product manifest.
// CNPG must use THAT password, not mint a random one, so migrated data and each
// app's POSTGRES_PASSWORD line up. ESO syncs the password into a
// kubernetes.io/basic-auth Secret (username "postgres"), which the Cluster
// references via bootstrap.initdb.secret + superuserSecret. (ESO must create
// that Secret before initdb runs; the operator retries until it appears.)

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import {
  captivePortalProductManifest,
  controlCenterProductManifest,
  type ProductDatabase,
} from "@repo/platform";

export interface CnpgArgs {
  provider: k8s.Provider;
  namespace: pulumi.Input<string>;
  // CNPG operator install manifest version (www-j934.4 preflight pin: 1.29.1).
  operatorVersion: string;
}

export interface CnpgResources {
  operator: k8s.yaml.ConfigFile;
  authSecrets: k8s.apiextensions.CustomResource[];
  clusters: k8s.apiextensions.CustomResource[];
  authSecret: k8s.apiextensions.CustomResource;
  cluster: k8s.apiextensions.CustomResource;
}

function productDatabases(): ProductDatabase[] {
  return [controlCenterProductManifest().database, captivePortalProductManifest().database];
}

function externalSecretResourceName(database: ProductDatabase): string {
  if (database.product === "control-center") return "es-postgres-auth";
  return `es-${database.authSecretName}`;
}

function createAuthSecret(
  database: ProductDatabase,
  namespace: pulumi.Input<string>,
  opts: pulumi.CustomResourceOptions,
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    externalSecretResourceName(database),
    {
      apiVersion: "external-secrets.io/v1",
      kind: "ExternalSecret",
      metadata: { name: externalSecretResourceName(database), namespace },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: { kind: "ClusterSecretStore", name: "onepassword" },
        target: {
          name: database.authSecretName,
          template: {
            type: "kubernetes.io/basic-auth",
            data: { username: database.owner, password: "{{ .password }}" },
          },
        },
        data: [{ secretKey: "password", remoteRef: { key: database.auth.password.remoteRef } }],
      },
    },
    opts,
  );
}

function createCluster(
  database: ProductDatabase,
  namespace: pulumi.Input<string>,
  operator: k8s.yaml.ConfigFile,
  authSecret: k8s.apiextensions.CustomResource,
  opts: pulumi.CustomResourceOptions,
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    database.clusterName,
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "Cluster",
      metadata: { name: database.clusterName, namespace },
      spec: {
        instances: 1,
        enableSuperuserAccess: true,
        superuserSecret: { name: database.authSecretName },
        bootstrap: {
          initdb: {
            database: database.databaseName,
            owner: database.owner,
            secret: { name: database.authSecretName },
          },
        },
        storage: { storageClass: database.storageClass, size: database.size },
        resources: database.resources,
      },
    },
    { ...opts, dependsOn: [operator, authSecret] },
  );
}

/**
 * @public - installs the CNPG operator and product-owned single-instance
 * Clusters with bridged credentials. Consumed by the cluster program; app
 * Deployments point DATABASE hosts at the read-write Services CNPG creates.
 */
export function installCnpg(args: CnpgArgs): CnpgResources {
  const { provider, namespace, operatorVersion } = args;
  const opts = { provider };

  const operator = new k8s.yaml.ConfigFile(
    "cnpg-operator",
    {
      file: `https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-${operatorVersion}.yaml`,
    },
    opts,
  );

  const databases = productDatabases();
  const authSecrets = databases.map((database) => createAuthSecret(database, namespace, opts));
  const clusters = databases.map((database, index) =>
    createCluster(database, namespace, operator, authSecrets[index], opts),
  );

  return { operator, authSecrets, clusters, authSecret: authSecrets[0], cluster: clusters[0] };
}
