#!/usr/bin/env bash
# Rotate the SOPS age key and optionally rewrite git history to purge old encrypted blobs.
#
# Usage:
#   scripts/rotate-sops-age-and-rewrite-history.sh [--rewrite-history]
#
# Phase 1 (always runs):
#   - Requires clean main, up to date with origin
#   - Generates new age keypair
#   - Decrypts vault with OLD key, re-encrypts with NEW key to a temp file
#   - Verifies new key works, old key no longer applies
#   - Replaces vault, updates .sops.yaml, then stores new key in Keychain + 1Password
#   - Commits rotation
#
# Phase 2 (only with --rewrite-history):
#   - Clones repo to a mirror in /tmp
#   - Uses git filter-repo to purge all historical secrets/vault.yaml blobs
#   - Re-adds the current re-encrypted vault on top
#   - Force-pushes rewritten main
#   - Prints reclone instructions
#
# NEVER prints either age key. Secrets stay in subshells / temp files only.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REWRITE_HISTORY=false
if [[ "${1:-}" == "--rewrite-history" ]]; then
  REWRITE_HISTORY=true
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()   { error "$@"; exit 1; }

umask 077

# Temp files — cleaned up on exit
# age-keygen -o refuses to write to an existing file, so use temp dir paths
TEMP_DIR=$(mktemp -d)
NEW_KEY_FILE="$TEMP_DIR/new-key.txt"
OLD_KEY_FILE="$TEMP_DIR/old-key.txt"
PLAINTEXT_VAULT_FILE="$TEMP_DIR/vault.plain.yaml"
NEW_VAULT_FILE="$TEMP_DIR/vault.new.yaml"
trap 'rm -rf "$TEMP_DIR"' EXIT

# ─── Phase 0: Prerequisites ──────────────────────────────────────────────────

info "Checking prerequisites..."

for cmd in age-keygen sops git-filter-repo; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found. Install it first."
done

cd "$REPO_ROOT"

# Must be on main
CURRENT_BRANCH=$(git branch --show-current)
[[ "$CURRENT_BRANCH" == "main" ]] || die "Must be on main branch (currently on '$CURRENT_BRANCH')"

# Main must be clean
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree is dirty. Commit or stash everything first."
fi

# Main must be up to date
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
  die "Local main is not up to date with origin/main. Run 'git pull --rebase' first."
fi

info "Prerequisites OK"

# ─── Phase 1: Rotate age key ─────────────────────────────────────────────────

# ── Save old key before overwriting Keychain ─────────────────────────────────

info "Reading old key from Keychain..."

OLD_KEYCHAIN_RAW=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w 2>/dev/null) \
  || die "Could not read old key from Keychain. Is 'age-world-wide-webb-private-key' in Keychain?"

echo "$OLD_KEYCHAIN_RAW" > "$OLD_KEY_FILE"

# ── Generate new keypair ─────────────────────────────────────────────────────

info "Generating new age keypair..."

age-keygen -o "$NEW_KEY_FILE" 2>/dev/null

NEW_PUBKEY=$(age-keygen -y "$NEW_KEY_FILE")
NEW_PRIVKEY=$(grep 'AGE-SECRET-KEY' "$NEW_KEY_FILE" | head -1)

# Extract old public key from .sops.yaml
OLD_PUBKEY=$(sed -n 's/^.*age: *//p' .sops.yaml | tr -d '[:space:]')

info "New public key: $NEW_PUBKEY"
info "Old public key: $OLD_PUBKEY"

# ── Re-encrypt vault (fresh ciphertext, old key excluded) ────────────────────

info "Decrypting existing vault with old key..."

SOPS_AGE_KEY=$(cat "$OLD_KEY_FILE") sops -d secrets/vault.yaml > "$PLAINTEXT_VAULT_FILE" \
  || die "Old key cannot decrypt secrets/vault.yaml. Keychain may not contain the key for this vault."

info "Encrypting temporary vault with new key..."

SOPS_AGE_KEY="$NEW_PRIVKEY" sops encrypt \
  --age "$NEW_PUBKEY" \
  --filename-override secrets/vault.yaml \
  --output "$NEW_VAULT_FILE" \
  "$PLAINTEXT_VAULT_FILE" \
  || die "New key failed to encrypt temporary vault."

# ── Verify before touching Keychain or 1Password ─────────────────────────────

info "Verifying temporary re-encrypted vault..."

if ! SOPS_AGE_KEY=$(cat "$NEW_KEY_FILE") sops -d "$NEW_VAULT_FILE" >/dev/null 2>&1; then
  die "FATAL: New key cannot decrypt temporary vault. Keychain and 1Password were not changed."
fi
info "New key decrypts temporary vault: OK"

if SOPS_AGE_KEY=$(cat "$OLD_KEY_FILE") sops -d "$NEW_VAULT_FILE" >/dev/null 2>&1; then
  die "FATAL: Old key can still decrypt temporary vault. Keychain and 1Password were not changed."
fi
info "Old key rejected by temporary vault: OK"

# ── Apply verified vault and config ──────────────────────────────────────────

info "Replacing secrets/vault.yaml with verified re-encrypted vault..."

mv "$NEW_VAULT_FILE" secrets/vault.yaml

# ── Update .sops.yaml ────────────────────────────────────────────────────────

info "Updating .sops.yaml with new public key..."

sed -i '' "s|^[[:space:]]*age:.*|    age: $NEW_PUBKEY|" .sops.yaml

info ".sops.yaml updated"

# ── Final verify ─────────────────────────────────────────────────────────────

info "Verifying final vault state..."

# Verify NEW key can decrypt
if ! SOPS_AGE_KEY=$(cat "$NEW_KEY_FILE") sops -d secrets/vault.yaml >/dev/null 2>&1; then
  die "FATAL: New key cannot decrypt vault after re-encryption!"
fi
info "New key decrypts vault: OK"

# Verify OLD key CANNOT decrypt
if SOPS_AGE_KEY=$(cat "$OLD_KEY_FILE") sops -d secrets/vault.yaml >/dev/null 2>&1; then
  die "FATAL: Old key can still decrypt the vault! Re-encryption did not exclude it."
fi
info "Old key rejected: OK"

# ── Store new private key in Keychain ────────────────────────────────────────

info "Storing new private key in Keychain..."

security delete-generic-password -a "$USER" -s "age-world-wide-webb-private-key" 2>/dev/null || true

security add-generic-password \
  -a "$USER" \
  -s "age-world-wide-webb-private-key" \
  -w "$NEW_PRIVKEY"

info "Keychain updated"

# ── Store new key in 1Password (interactive) ─────────────────────────────────

info ""
info "═══════════════════════════════════════════════════════════════════════"
info "  ACTION REQUIRED: Store the new private key in 1Password"
info "═══════════════════════════════════════════════════════════════════════"
info ""
info "  Item: 'SOPS Age worldwidewebb Key' (Homelab vault)"
info "  Field: replace the private key value with the NEW key"
info ""
info "  The new key is at: $NEW_KEY_FILE"
info "  The vault and Keychain already verified successfully."
info ""
read -r -p "Press Enter when done (or Ctrl+C to abort)... "

# ── Commit rotation ──────────────────────────────────────────────────────────

info "Committing rotation..."

git add .sops.yaml secrets/vault.yaml
git commit -m "chore(security): rotate SOPS age key after compromise

Generated new age keypair, updated .sops.yaml with new public key,
re-encrypted secrets/vault.yaml with fresh ciphertext. Old key no
longer has access to the vault."

info "Rotation committed: $(git rev-parse --short HEAD)"

# ─── Phase 2: Rewrite git history ────────────────────────────────────────────

if [[ "$REWRITE_HISTORY" != "true" ]]; then
  info ""
  info "Phase 1 complete. Rotation committed."
  info ""
  info "To rewrite history (purge old vault blobs from git history):"
  info "  $0 --rewrite-history"
  info ""
  info "WARNING: History rewrite requires a force-push and will invalidate"
  info "all existing clones. Everyone must reclone after the rewrite."
  exit 0
fi

info ""
info "═══════════════════════════════════════════════════════════════════════"
info "  PHASE 2: REWRITING GIT HISTORY"
info "═══════════════════════════════════════════════════════════════════════"
info ""

# ── Clone mirror ──────────────────────────────────────────────────────────────

MIRROR_DIR="/tmp/rewrite-$(basename "$REPO_ROOT")-$(date +%s)"
info "Cloning mirror to $MIRROR_DIR..."

git clone --mirror origin "$MIRROR_DIR" 2>/dev/null

# ── Rewrite history ──────────────────────────────────────────────────────────

info "Running git filter-repo to purge secrets/vault.yaml history..."

cd "$MIRROR_DIR"
git filter-repo \
  --invert-paths \
  --path secrets/vault.yaml \
  --force 2>/dev/null

info "History rewritten. Old vault blobs purged."

# ── Re-add current vault ─────────────────────────────────────────────────────

info "Re-adding current re-encrypted vault..."

WORK_DIR=$(mktemp -d)
git worktree add "$WORK_DIR" HEAD 2>/dev/null

cp "$REPO_ROOT/secrets/vault.yaml" "$WORK_DIR/secrets/vault.yaml"

cd "$WORK_DIR"
git add secrets/vault.yaml
git commit -m "chore(security): re-add re-encrypted vault after history purge

Old vault blobs encrypted with the compromised age key have been
purged from git history. This commit adds the re-encrypted vault
which is only decryptable with the new age key."

# Push back to mirror
git push origin main --force 2>/dev/null

# ── Cleanup ──────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"
git worktree remove "$WORK_DIR" 2>/dev/null || true
rm -rf "$MIRROR_DIR"

# ── Done ──────────────────────────────────────────────────────────────────────

info ""
info "═══════════════════════════════════════════════════════════════════════"
info "  COMPLETE"
info "═══════════════════════════════════════════════════════════════════════"
info ""
info "  History rewritten. All old vault blobs are purged."
info ""
info "  EVERYONE must reclone the repo:"
info "    git clone git@github.com:0x63616c/world-wide-webb.git"
info ""
info "  Old clones still have the compromised objects."
info ""
info "  Next steps:"
info "    1. Rotate all individual credentials in the vault"
info "    2. Run 'gitleaks git . -c .gitleaks.toml' to verify clean history"
info "    3. Tell collaborators to reclone"
info ""
