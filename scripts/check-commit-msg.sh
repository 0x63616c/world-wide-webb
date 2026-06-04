#!/usr/bin/env bash
# Validates a commit message before it is written.
#
# Two enforced invariants (both must hold, or the commit is rejected):
#   1. The subject (first line) is a valid Conventional Commit:
#        type(scope)!: description
#      where type ∈ {feat, fix, chore, refactor, docs, test, ci, build,
#      perf, style, revert}, the (scope) and trailing ! are optional.
#   2. The message references at least one beads ticket id (token like
#      www-w5y, or a `refs www-w5y` trailer), AND that id is a REAL issue.
#      Existence is checked cheaply with a single `bd show <id>` per ref —
#      bd exits non-zero for unknown ids.
#
# Graceful degradation: if `bd` is not on PATH (offline / not installed) we
# warn and skip existence checks rather than failing closed. A commit-msg
# hook that hard-blocks when tooling is missing would strand all work, which
# is worse than a missed validation.
#
# Invoked by lefthook's commit-msg stage with the path to the message file.

set -euo pipefail

MSG_FILE="${1:?commit-msg hook: expected path to commit message file}"

# Strip comment lines (git's commit template) before reading the subject.
SUBJECT="$(grep -v -E '^\s*#' "$MSG_FILE" | grep -v -E '^\s*$' | head -n1 || true)"
BODY="$(cat "$MSG_FILE")"

# Allowed Conventional Commit types.
TYPES='feat|fix|chore|refactor|docs|test|ci|build|perf|style|revert'
# type(optional-scope)optional-bang: at least one char of description.
SUBJECT_RE="^(${TYPES})(\([a-z0-9._/-]+\))?!?: .+"

claude_reminder() {
  echo ""
  echo "  Claude: EVERY change needs a commit that references a real bd ticket — no exceptions."
  echo "  Conventional Commit subject + a real bd id (e.g. 'refs www-w5y') in the body are mandatory."
  echo "  If no ticket exists for this work, create one with 'bd create' first, then reference it."
}

fail=0

# --- 1. Conventional Commit subject ----------------------------------------
if ! echo "$SUBJECT" | grep -qE "$SUBJECT_RE"; then
  echo "REJECTED: subject is not a Conventional Commit."
  echo "  got:      ${SUBJECT:-<empty>}"
  echo "  expected: type(scope): description   (type ∈ ${TYPES})"
  fail=1
fi

# --- 2. References at least one bd ticket id, and it is real ----------------
# bd ids look like www-w5y: an uppercase prefix, a dash, then alnum chars.
# Portable collection (no mapfile — macOS ships bash 3.2).
REFS=()
while IFS= read -r ref; do
  [ -n "$ref" ] && REFS+=("$ref")
done < <(echo "$BODY" | grep -oE '[A-Z]+-[a-z0-9]+' | sort -u || true)

if [ "${#REFS[@]}" -eq 0 ]; then
  echo "REJECTED: no bd ticket id referenced (e.g. add a 'refs www-w5y' trailer)."
  fail=1
elif ! command -v bd >/dev/null 2>&1; then
  # bd unavailable — warn but do not hard-block.
  echo "WARNING: 'bd' not found on PATH; skipping ticket-existence check for: ${REFS[*]}"
else
  for ref in "${REFS[@]}"; do
    if ! bd show "$ref" >/dev/null 2>&1; then
      echo "REJECTED: referenced bd ticket '$ref' does not exist (bd show failed)."
      fail=1
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  claude_reminder
  exit 1
fi
