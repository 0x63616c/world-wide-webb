# Cloudflare OpenTofu candidate

This directory contains the replacement HCL beside the retained Pulumi recovery
source. It has only been validated locally with mocked provider tests. No resource
has been imported, recreated or applied, and no state backend has been provisioned.
Never run both writers. Remove Pulumi source only after ownership transfer and
cutover verification; do not destroy its resources to remove its state.

## Local verification (no credentials / no remote state)

```sh
tofu init -backend=false -input=false
tofu fmt -check -recursive
tofu validate
tofu test
```

The provider is pinned in versions.tf and the committed lockfile. Mock tests
check route/access coverage and web hostname retirement; they do not certify
live API behavior, import fidelity or remote backend locking.

## State backend

Use **AWS S3 with native conditional-write locking**, bucket versioning, public
access blocked and server-side encryption. This is an intentionally concrete,
supported option rather than assuming R2 implements the S3 locking API. A new
AWS account/bucket is NOT created by this candidate. Before choosing/provisioning
anything, the primary agent should check existing suitable remote storage. If no
AWS account is available, resolve the alternative explicitly before production.
See https://opentofu.org/docs/language/settings/backends/s3/ .

The backend configuration fixes `encrypt = true` and `use_lockfile = true`.
Supply bucket, region and key via a private `backend.hcl` outside Git. Credentials
use short-lived AWS environment/OIDC identity, not HCL. Example init command:
`tofu init -backend-config=/private/path/backend.hcl`. Do not put account IDs,
credentials or actual state locations in the public repo. Before adoption, prove
that concurrent writers cannot acquire the same state lock and that a versioned
state backup can be restored. GitHub workflow concurrency is additional protection.
The backend must be recoverable without the app/tunnel it manages.

## Inputs and ownership transition

Cloudflare credentials use `CLOUDFLARE_API_TOKEN`. Variable values use the secret
system via protected `TF_VAR_*` environment variables; never echo them. State and
plans contain private values even when display is marked sensitive.

Required variables: `account_id`, `zone_id`, `allowed_email`. `zone_name` defaults
to worldwidewebb.co. `api_service_token_ids` lists UUIDs of privately provisioned
device/automation tokens, not their client IDs/secrets. Empty means no service-auth
policy. Until replacement enrollment is ready, carry forward existing authorized
token IDs privately to avoid locking out native clients; rotate them at cutover.
`retain_legacy_app` defaults true for adoption; set false only after api clients work.
`apply_access_gate` remains false unless deliberately enabled, matching the old stack.

1. Hold backend deploy, Pulumi apply and Apple publication separately. Drain in-flight
   runs. Export encrypted recovery state through supported tooling; never print it.
2. Import existing tunnel, ingress configuration, DNS records and Access applications
   using IDs supplied privately. Check the pinned provider's exact import syntax.
   Existing app-scoped Access policies may need replacement with the declared reusable
   policies; this is not guaranteed to be a zero-diff migration. Preserve effective
   email and service-auth rules before unlinking the old policies.
3. Inspect plan for every shared hostname: ha, hindsight, bambuddy and dsm must keep
   their origins and Access policies. DSM alone retains the existing TLS exception.
   The terminal tunnel route is http_status:404. Tunnel deletion is protected.
4. The old release-path-specific ingress forwarded to the same origin as its host
   catchall; the HCL intentionally routes all api paths to that origin.
5. Establish api.worldwidewebb.co and native access; then deliberately retire app.
   Preserve the connector token or privately replace it if recreating the tunnel.
6. Retire Pulumi ownership without destroying resources; back up the accepted new state.

Do not place real plan/state files, backend credentials, tokens or tfvars in Git.
