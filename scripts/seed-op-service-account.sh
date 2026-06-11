#!/usr/bin/env bash
# Seed the ONE bootstrap secret ESO needs: the 1Password service-account token,
# into k8s Secret `op-service-account` in the external-secrets namespace
# (CC-j934.4). Run ONCE per cluster (and after a token rotation), by a human or
# the deploy pipeline. Everything else flows through ESO from this seed.
#
# The token is read from 1Password and piped straight into kubectl; it is never
# written to disk, never echoed, never committed. Idempotent: re-running updates
# the Secret in place (apply).
set -euo pipefail

NS="external-secrets"
SECRET="op-service-account"
KEY="token"
# Reference the item by its 1P ID, not its title: the title
# "Service Account Auth Token: Homelab" contains a colon, which `op read`
# rejects as an invalid character in a secret reference (same reason
# deploy.config.ts uses this id for OP_SERVICE_ACCOUNT_TOKEN). The id is stable.
REF="op://Homelab/twioy4ncbhijeahcqgqrwfoeiq/credential"
CONTEXT="${KUBE_CONTEXT:-orbstack}"

echo "Seeding $SECRET into namespace $NS (context: $CONTEXT)..."

# The namespace is created by the ESO Pulumi release, but seeding may run first;
# create it if absent so the apply never races.
kubectl --context "$CONTEXT" create namespace "$NS" --dry-run=client -o yaml \
  | kubectl --context "$CONTEXT" apply -f - >/dev/null

TOKEN="$(op read "$REF")"
[ -n "$TOKEN" ] || { echo "FATAL: empty service-account token from $REF" >&2; exit 1; }

# --dry-run + apply so it's idempotent (updates in place); token only ever in
# the pipe, never a temp file, never printed.
kubectl --context "$CONTEXT" create secret generic "$SECRET" \
  --namespace "$NS" \
  --from-literal="$KEY=$TOKEN" \
  --dry-run=client -o yaml \
  | kubectl --context "$CONTEXT" apply -f - >/dev/null

unset TOKEN
echo "  done. ESO's ClusterSecretStore 'onepassword' reads $NS/$SECRET key '$KEY'."
echo "  Verify (no value printed): kubectl --context $CONTEXT get secret $SECRET -n $NS"
