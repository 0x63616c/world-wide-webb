#!/usr/bin/env bash
# Disposable synthetic identities only; no production key or fixture in Git.
set -euo pipefail
umask 077
verifier=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for identity in host recovery wrong; do
  age-keygen -o "$work/$identity.key" 2> /dev/null
done
host_recipient=$(age-keygen -y "$work/host.key")
recovery_recipient=$(age-keygen -y "$work/recovery.key")
printf 'probe: synthetic-fixture\n' > "$work/plain.yaml"
sops --encrypt --age "$host_recipient,$recovery_recipient" \
  --input-type yaml --output-type yaml "$work/plain.yaml" > "$work/host.sops.yaml"
sops_binary=$(command -v sops)
output=$("$verifier" verify-host-secrets --key "$work/host.key" \
  --ciphertext "$work/host.sops.yaml" --sops "$sops_binary")
test -z "$output"
mkdir -p "$work/operator/sops/age"
cp "$work/recovery.key" "$work/operator/sops/age/keys.txt"
# A valid operator recovery key must not mask a wrong host identity.
export SOPS_AGE_KEY_FILE="$work/recovery.key"
export SOPS_AGE_KEY
SOPS_AGE_KEY=$(cat "$work/recovery.key")
export XDG_CONFIG_HOME="$work/operator"
if "$verifier" verify-host-secrets --key "$work/wrong.key" \
  --ciphertext "$work/host.sops.yaml" --sops "$sops_binary" > /dev/null 2>&1; then
  echo 'Wrong host key was accepted through operator fallback credentials.' >&2
  exit 1
fi
printf 'Host-only SOPS decryption checks passed\n'
