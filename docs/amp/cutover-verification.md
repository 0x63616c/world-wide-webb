# AMP Production Cutover Verification

Status: **REQUIRES CALUM** (www-jtp0.8.7). Live cluster and Cloudflare access needed
for every step below. The declarative CF Access and route changes are committed (www-jtp0.8.6)
and reviewed; this checklist gates the first `pulumi up` that creates AMP resources.

---

## 0. Human review gate (before any apply)

**Complete this before running `pulumi up`:**

```bash
# Preview CF Access and route changes:
pulumi preview --stack prod --cwd infra/cloudflare
```

Expected diff (zero deletes, zero replaces):

- 1 `ZeroTrustAccessApplication` create (`app.amp.worldwidewebb.co`)
- 1 `ZeroTrustAccessPolicy` create (`app-amp-email-otp`)
- 1 `ZeroTrustTunnelCloudflaredConfig` update (adds `app.amp.worldwidewebb.co` ingress rule)
- 1 `Record` create (`app.amp` CNAME to tunnel)
- `api.amp.worldwidewebb.co` must NOT appear in the preview output

If the preview shows any delete or replace, stop and investigate before applying.

---

## 1. CI image digest verification

Confirm the `amp-app` image was built and the digest is pinned in Pulumi config before
any workload rolls:

```bash
# Digest must be set (non-empty):
pulumi config get --stack prod ccinfra:imageDigests.amp-app

# Cross-check the GHCR tag:
gh api /orgs/0x63616c/packages/container/amp-app/versions \
  --jq '.[0].metadata.container.tags'
# Expected: includes "main" or a SHA tag

# Confirm CI run was green for the AMP image build job:
gh run list --workflow ci.yml --limit 5
```

---

## 2. kubectl verification (namespace: `amp`)

```bash
# Namespace exists:
kubectl --context cc-homelab get namespace amp

# Deployment is present and Available:
kubectl --context cc-homelab -n amp get deployment amp-app -o wide

# At least 1 pod is Running/Ready:
kubectl --context cc-homelab -n amp get pods -l app.kubernetes.io/name=amp -o wide

# Service exists:
kubectl --context cc-homelab -n amp get service amp-app

# No database resources (AMP v0 is stateless):
kubectl --context cc-homelab -n amp get cluster 2>&1 | grep -i "not found"
kubectl --context cc-homelab -n amp get pvc 2>&1 | grep -i "no resources"

# Secrets: only image-pull secrets expected, no postgres-auth:
kubectl --context cc-homelab -n amp get secret
```

---

## 3. kubectl logs verification

```bash
kubectl --context cc-homelab -n amp logs \
  -l app.kubernetes.io/name=amp --tail=50

# Expected: nginx startup lines or app access logs, no crash loops
# Confirm no database connection errors (AMP is stateless)
```

---

## 4. Cluster/local health endpoint

```bash
# Internal health check from inside the cluster:
kubectl --context cc-homelab -n amp exec -it deployment/amp-app -- \
  wget -qO- http://localhost:80/

# Expected: HTTP 200, AMP app HTML
```

---

## 5. TLS and Cloudflare Access deny/allow checks

```bash
# Unauthenticated request MUST be denied (redirect to CF Access login):
curl -sI https://app.amp.worldwidewebb.co/
# Expected: HTTP 302 redirect to Cloudflare Access login page, NOT 200

# TLS cert is valid for app.amp.worldwidewebb.co:
openssl s_client -connect app.amp.worldwidewebb.co:443 \
  -servername app.amp.worldwidewebb.co </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -dates
# Expected: subject includes *.worldwidewebb.co or app.amp.worldwidewebb.co

# Authenticated access (requires a device enrolled in Cloudflare Access or a
# valid CF_Authorization JWT):
# 1. Open https://app.amp.worldwidewebb.co in a browser enrolled in Access
# 2. Authenticate via email OTP (the allowedEmail from Pulumi config)
# 3. Confirm HTTP 200 and the AMP app renders
```

---

## 6. Rollback drill

AMP v0 has no database, so rollback is reversible with no data loss.

```bash
# Option A: scale to zero (stops traffic, leaves resource intact):
kubectl --context cc-homelab -n amp scale deployment amp-app --replicas=0

# Option B: remove CF Access + route (reverts www-jtp0.8.6 changes):
# Revert infra/cloudflare/src/access.ts and src/routes.ts to before www-jtp0.8.6,
# then run:
pulumi up --stack prod --cwd infra/cloudflare
# This removes the ZeroTrustAccessApplication, policy, ingress rule, and CNAME.

# Restore from option A:
kubectl --context cc-homelab -n amp scale deployment amp-app --replicas=1
```

---

## Checklist summary

- [ ] Human review: `pulumi preview` matches expected diff (1 create each, zero deletes)
- [ ] CI green, `amp-app` digest pinned in Pulumi config
- [ ] kubectl: namespace, deployment, pod Running, service present, no PVC/cluster
- [ ] kubectl logs: nginx startup, no crash loops, no DB errors
- [ ] Internal health: `localhost:80` returns 200
- [ ] TLS: valid cert for `app.amp.worldwidewebb.co`
- [ ] Unauthenticated: `curl -sI` returns 302 to CF Access login
- [ ] Authenticated: browser access after email OTP returns 200
- [ ] Rollback drill: scale-to-zero tested or rollback path documented and understood
