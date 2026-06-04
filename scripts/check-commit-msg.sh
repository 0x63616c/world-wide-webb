#!/usr/bin/env bash
# Validates a commit message before it is written.
#
# Two enforced invariants (both must hold, or the commit is rejected):
#   1. The subject (first line) is a valid Conventional Commit whose scope
#      carries a mandatory area AND a bd ticket id:
#        type(area/www-w5y)!: description
#      - type ∈ {feat, fix, chore, refactor, docs, test, ci, build, perf,
#        style, revert}
#      - area is one or more lowercase path segments (e.g. weather,
#        web/tiles); it is REQUIRED
#      - the ticket id is the final scope segment (www-w5y); it is REQUIRED
#        and MUST live in the scope (a body-only 'refs www-w5y' does NOT count)
#      - the trailing ! (breaking change) is optional
#   2. The ticket id in the scope is a REAL issue. Existence is checked
#      cheaply with a single `bd show <id>` — bd exits non-zero for unknown
#      ids.
#
# Graceful degradation: if `bd` is not on PATH (offline / not installed) we
# warn and skip the existence check rather than failing closed. A commit-msg
# hook that hard-blocks when tooling is missing would strand all work, which
# is worse than a missed validation.
#
# Invoked by lefthook's commit-msg stage with the path to the message file.

set -euo pipefail

MSG_FILE="${1:?commit-msg hook: expected path to commit message file}"

# Strip comment lines (git's commit template) before reading the subject.
SUBJECT="$(grep -v -E '^\s*#' "$MSG_FILE" | grep -v -E '^\s*$' | head -n1 || true)"

# Allowed Conventional Commit types.
TYPES='feat|fix|chore|refactor|docs|test|ci|build|perf|style|revert'
# A bd ticket id: uppercase prefix, dash, lowercase-alnum suffix (e.g. www-w5y).
TICKET_RE='[A-Z]+-[a-z0-9]+'
# type(area/TICKET)!: desc — area is required lowercase segment(s), the ticket
# is the final scope segment, the bang is optional, description is non-empty.
SUBJECT_RE="^(${TYPES})\([a-z0-9._/-]+/${TICKET_RE}\)!?: .+"

claude_reminder() {
  echo ""
  echo "  Claude: EVERY change needs a commit subject of the form type(area/www-xxx): desc"
  echo "  with a REAL bd ticket id in the scope — no exceptions. Area is mandatory."
  echo "  Example: feat(weather/www-m9k): add Open-Meteo poller"
  echo "  If no ticket exists for this work, create one with 'bd create' first."
}

fail=0

# --- 1. Conventional Commit subject with area/ticket scope -----------------
if ! echo "$SUBJECT" | grep -qE "$SUBJECT_RE"; then
  echo "REJECTED: subject is not a Conventional Commit with an area/ticket scope."
  echo "  got:      ${SUBJECT:-<empty>}"
  echo "  expected: type(area/www-xxx)[!]: description   (type ∈ ${TYPES})"
  echo "            area is mandatory; the bd ticket id MUST be in the scope."
  claude_reminder
  exit 1
fi

# --- 2. The ticket id in the scope is a real bd issue ----------------------
# Extract the scope (between the first '(' and its ')'), then take the final
# '/'-separated segment as the ticket id.
SCOPE="$(echo "$SUBJECT" | sed -E 's/^[^(]*\(([^)]*)\).*/\1/')"
TICKET="${SCOPE##*/}"

if ! command -v bd >/dev/null 2>&1; then
  # bd unavailable — warn but do not hard-block.
  echo "WARNING: 'bd' not found on PATH; skipping ticket-existence check for: ${TICKET}"
elif ! bd show "$TICKET" >/dev/null 2>&1; then
  echo "REJECTED: bd ticket '$TICKET' (from scope) does not exist (bd show failed)."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  claude_reminder
  exit 1
fi
