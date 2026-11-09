# Production infrastructure

The first managed service is incoming support-email forwarding. Remote state is encrypted using the **Folding OpenTofu production state key** in 1Password. The private destination is read from project connections into `TF_VAR_support_destination`; never put it in a committed variable file. Provider credentials are supplied as `CLOUDFLARE_API_TOKEN`; R2 state credentials use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

From one persistent authorized shell:

```sh
tofu -chdir=infra/cloudflare/folding/production init
tofu -chdir=infra/cloudflare/folding/production plan -out=production.tfplan
# Inspect the saved plan before applying.
tofu -chdir=infra/cloudflare/folding/production apply production.tfplan
python3 scripts/backup-infrastructure-state.py production
```

Use the infrastructure Python dependencies from `scripts/requirements-infra.txt`. The backup script preserves encrypted bytes, creates a unique conditional-write object and verifies the bytes. Bucket-enforced backup retention and restricted CI identities remain required before routine automated deployment; this initial owner-operated bootstrap has no CI credentials.

The application module also owns D1, private avatar storage, job queues, admin Access and routing. Supply `TF_VAR_account_id`, `TF_VAR_zone_id` and an explicit JSON `TF_VAR_admin_emails` allowlist. `application_routes_enabled` defaults to false: first provision resources, generate bindings and deploy Worker code, then enable routes through a second saved plan. Staging uses the same module with a separate encrypted state key and isolated resources.
