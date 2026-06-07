#!/usr/bin/env bash
# PreToolUse(Bash) guard (control-center) — block bare `bun test`.
#
# Why: Bun's native test runner is incompatible with vi.mock and produces
# false failures (documented in CLAUDE.md). The vitest runner is invoked via
# `bun run test`. Agents repeatedly typed `bun test`, got phantom failures,
# and burned turns chasing them. This makes the rule a mechanical invariant.
#
# Mention-safe: matches `bun test` only in command position (start or after a
# shell separator), and only when the next token is NOT `run`. So `bun run
# test`, `bun run test:coverage`, and a string that merely contains "bun test"
# all pass.

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$cmd" ] && exit 0

norm=$(printf '%s' "$cmd" | tr '\n' ' ' | tr -s '[:space:]' ' ')
pre='(^|[;&|`(]|&&|\|\|)[[:space:]]*'

if printf '%s' "$norm" | grep -Eq "${pre}bun[[:space:]]+test([[:space:]]|$)"; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: bare `bun test` uses Bun's native runner, which is incompatible with vi.mock and reports false failures. Use `bun run test` (vitest) instead, or `bun run test:coverage` for the merged run."}}
JSON
  exit 0
fi
exit 0
