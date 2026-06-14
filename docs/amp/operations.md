# AMP Operations

Status: **CURRENT** (www-jtp0.8.8). AMP v0 is live as a stateless private web product.

---

## Identity

| Property | Value |
|---|---|
| Product slug | `amp` |
| DNS code | `amp` |
| Kubernetes namespace | `amp` |
| Workload | `amp-app` (Deployment) |
| Image | `ghcr.io/0x63616c/amp-app:main` |
| Exposure | `privateWeb` at `app.amp.worldwidewebb.co` |
| Access policy | Cloudflare Access email-OTP (`allowedEmail` from Pulumi config) |
| Database | None (stateless) |
| Secrets | None (no ESO ExternalSecret for AMP) |
| API surface | None (`api.amp.worldwidewebb.co` is not declared) |

---

## Architecture: AMP v0 is stateless

AMP is a static nginx SPA with no backend, no database, and no secrets. The Kubernetes
`Deployment` runs one or more replicas of the nginx image; there is no `Cluster` (CNPG),
no `PersistentVolumeClaim`, and no `ExternalSecret`. The product is exposed exclusively
through the Cloudflare tunnel at `app.amp.worldwidewebb.co` behind Cloudflare Access
email-OTP. There is no `api.amp.worldwidewebb.co` route by default.

Declarative home:

- Platform manifest: `packages/platform/src/index.ts` (`ampProductManifest()`)
- CF Access + tunnel route: `infra/cloudflare/src/access.ts` + `infra/cloudflare/src/routes.ts`
- Pulumi k8s workload: `infra/src/` (declared via the standard product deployment model)
- CI build: `.github/workflows/ci.yml` `build-amp` job, path-filtered on `products/amp/**`

---

## Health checks

```bash
# Pod status:
kubectl --context cc-homelab -n amp get pods -l app.kubernetes.io/name=amp -o wide

# Internal HTTP probe:
kubectl --context cc-homelab -n amp exec -it deployment/amp-app -- \
  wget -qO- http://localhost:80/

# External (unauthenticated request should return 302 to CF Access login):
curl -sI https://app.amp.worldwidewebb.co/
```

---

## Logs

```bash
kubectl --context cc-homelab -n amp logs \
  -l app.kubernetes.io/name=amp --tail=100 --follow
```

AMP has no backend process, so logs are nginx access/error logs only. No database
connection errors are expected (there is no database).

---

## Route verification

```bash
# CF tunnel ingress rule and CNAME:
pulumi --cwd infra/cloudflare stack output --stack prod 2>/dev/null | grep amp
dig app.amp.worldwidewebb.co
# Expected: CNAME to <tunnelId>.cfargotunnel.com
```

---

## Rollback

AMP v0 has no database, so rollback carries no data-loss risk.

```bash
# Option A: scale to zero (stops traffic, leaves CF Access + CNAME intact):
kubectl --context cc-homelab -n amp scale deployment amp-app --replicas=0
# Restore:
kubectl --context cc-homelab -n amp scale deployment amp-app --replicas=1

# Option B: remove CF Access + route entirely (reverts www-jtp0.8.6):
# Revert infra/cloudflare/src/access.ts and src/routes.ts to before www-jtp0.8.6, then:
pulumi up --stack prod --cwd infra/cloudflare
# This removes ZeroTrustAccessApplication, policy, ingress rule, and CNAME.
# Re-apply by reverting the revert and running pulumi up again.
```

---

## Extension: adding a database

AMP v0 is stateless by design. If a future version requires a database, follow the
platform contract used by control-center and captive-portal:

1. Add a `DatabaseDeclaration` to `ampProductManifest()` in `packages/platform/src/index.ts`,
   including the CNPG `Cluster` resource, auth secret, and resource sizing.
2. Declare a `DatabaseBackup` pointing at the NAS export path under
   `backups/world-wide-webb/amp/postgres`, matching the nightly schedule used by other
   products (see `infra/src/crons.ts`).
3. Add a CronJob for the backup in `infra/src/crons.ts` (Kubernetes-native `CronJob`).
4. Run and pass a restore proof script (`scripts/pg-snapshot-restore.sh`) before any
   production data migration.
5. **Human review checkpoint required** before any `pulumi up` that creates AMP database
   resources. A database add is irreversible once data is written.

---

## Extension: adding an API route (`api.amp.worldwidewebb.co`)

AMP v0 has no API surface. The `api.amp.worldwidewebb.co` hostname is intentionally absent
from `desiredAccessApps()` and `desiredIngressRules()` (enforced by the routes test:
"api.amp is NEVER tunneled").

To add an API route in a future version:

1. Add an `api` service to `ampProductManifest()` with `privateWeb(amp, target, { host: "api" })`
   (or `publicWeb` if the API should be public).
2. Add a `CloudflareExposureSource` entry in `productRoutes()` in `infra/cloudflare/src/routes.ts`.
3. Update `desiredAccessApps()` in `infra/cloudflare/src/access.ts` to include the policy
   for `api.amp.worldwidewebb.co` (email-otp or service-token as appropriate).
4. Update the test in `infra/cloudflare/test/routes.test.ts` to add `api.amp` to the
   expected ingress/CNAME lists. Update the negative assertion accordingly.
5. **Human review checkpoint required** before any `pulumi up --stack prod` that creates the
   `api.amp` CF Access application and CNAME. The `pulumi preview` must show zero deletes.
