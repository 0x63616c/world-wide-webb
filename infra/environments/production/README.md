# Production infrastructure

The first managed service is incoming support-email forwarding. Remote state is encrypted using the **Folding OpenTofu production state key** in 1Password. The private destination is read from project connections into `TF_VAR_support_destination`; never put it in a committed variable file. Provider credentials are supplied as `CLOUDFLARE_API_TOKEN`; R2 state credentials use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

From one persistent authorized shell:

```sh
tofu -chdir=infra/environments/production init
tofu -chdir=infra/environments/production plan -out=production.tfplan
# Inspect the saved plan before applying.
tofu -chdir=infra/environments/production apply production.tfplan
python3 scripts/backup-infrastructure-state.py production
```

Use the infrastructure Python dependencies from `scripts/requirements-infra.txt`. The backup script preserves encrypted bytes, creates a unique conditional-write object and verifies the bytes. Bucket-enforced backup retention and restricted CI identities remain required before routine automated deployment; this initial owner-operated bootstrap has no CI credentials.

The root intentionally does not yet contain backend resources. Add those through reviewed OpenTofu changes as the Worker implementation is introduced.
