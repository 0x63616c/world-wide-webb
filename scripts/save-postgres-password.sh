#!/usr/bin/env bash
# Generates a strong Postgres password, stores it in 1Password (Homelab vault),
# and invalidates the op shim cache so the next bosun deploy picks it up.
# Run once before the first bosun deploy; safe to re-run to rotate the password.
set -euo pipefail

ITEM="Control Center Postgres"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/password"

echo "Generating a new Postgres password for control-center..."
echo "(This will overwrite any existing value in 1Password.)"
echo ""

# Generate a 32-character random password — no shell-special chars so it's
# safe to pass directly in postgres DSN strings.
GENERATED=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)

# Allow override: paste your own if you need to match an existing database.
echo "Generated: (hidden)"
read -rsp "Press Enter to use the generated password, or paste your own: " OVERRIDE; echo
VAL="${OVERRIDE:-$GENERATED}"
[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" "password[password]=$VAL" >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "Database" \
    --title "$ITEM" \
    "password[password]=$VAL" \
    "username[text]=control_center" \
    "database[text]=control_center" \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so bosun reads the new value immediately.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$REF" >/dev/null && echo "  ok — $REF is readable"
echo "Done. Reference: $REF"
